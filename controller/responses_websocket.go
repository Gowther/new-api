package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	appmodel "github.com/QuantumNous/new-api/model"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type responsesWSRequestContextKey struct{}

type responsesWSRequestState struct {
	requestID string
	handle    func(*gin.Context) *types.NewAPIError
	apiError  *types.NewAPIError
}

// Each response.create runs the ordinary authentication and rate-limit
// middleware to completion, without routing another HTTP request or retaining
// a pooled Gin context.
var responsesWSRequestEngine = sync.OnceValue(func() *gin.Engine {
	engine := gin.New()
	engine.ForwardedByClientIP = false
	_ = engine.SetTrustedProxies(nil)
	engine.POST("/v1/responses", func(c *gin.Context) {
		state := c.Request.Context().Value(responsesWSRequestContextKey{}).(*responsesWSRequestState)
		c.Set(common.RequestIdKey, state.requestID)
		common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Now())
		c.Next()
	}, middleware.BodyStorageCleanup(), middleware.TokenAuth(), middleware.ModelRequestRateLimit(), func(c *gin.Context) {
		state := c.Request.Context().Value(responsesWSRequestContextKey{}).(*responsesWSRequestState)
		state.apiError = state.handle(c)
		if state.apiError != nil {
			status := state.apiError.StatusCode
			if status < http.StatusBadRequest {
				status = http.StatusInternalServerError
			}
			c.Status(status)
		}
	})
	return engine
})

type responsesWSResponseWriter struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *responsesWSResponseWriter) Header() http.Header {
	return w.header
}

func (w *responsesWSResponseWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}

func (w *responsesWSResponseWriter) Write(data []byte) (int, error) {
	w.WriteHeader(http.StatusOK)
	return w.body.Write(data)
}

func newResponsesWSRequestRunner(c *gin.Context) ResponsesWSRequestRunner {
	// Capture credentials before channel selection or header overrides. Resolve
	// the peer once with the public router's trusted-proxy configuration.
	headers := c.Request.Header.Clone()
	for _, name := range []string{"Connection", "Upgrade", "Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Extensions", "Sec-WebSocket-Protocol", "Content-Length", "Content-Encoding"} {
		headers.Del(name)
	}
	remoteAddr := net.JoinHostPort(c.ClientIP(), "0")
	return func(request *http.Request, requestID string, handle func(*gin.Context) *types.NewAPIError) *types.NewAPIError {
		state := &responsesWSRequestState{requestID: requestID, handle: handle}
		ctx := context.WithValue(request.Context(), responsesWSRequestContextKey{}, state)
		ctx = context.WithValue(ctx, common.RequestIdKey, requestID)
		request = request.Clone(ctx)
		request.Method = http.MethodPost
		request.URL.Path = "/v1/responses"
		request.URL.RawPath = ""
		request.Header = headers.Clone()
		request.Header.Set("Content-Type", "application/json")
		request.RemoteAddr = remoteAddr
		response := &responsesWSResponseWriter{header: make(http.Header)}
		responsesWSRequestEngine().ServeHTTP(response, request)
		if state.apiError != nil {
			return state.apiError
		}
		if response.status < http.StatusBadRequest {
			return nil
		}
		var body struct {
			Error *types.OpenAIError `json:"error"`
		}
		if common.Unmarshal(response.body.Bytes(), &body) == nil && body.Error != nil {
			return types.WithOpenAIError(*body.Error, response.status, types.ErrOptionWithSkipRetry())
		}
		// The existing in-memory rate limiter returns a bare 429 response.
		return types.NewErrorWithStatusCode(errors.New(http.StatusText(response.status)), types.ErrorCodeInvalidRequest, response.status, types.ErrOptionWithSkipRetry())
	}
}

// ResponsesWebSocket serves the Responses API over a WebSocket connection
// (GET /v1/responses with an upgrade). Channel selection happens after the
// first response.create event; each event runs the ordinary request pipeline.
func ResponsesWebSocket(c *gin.Context) {
	requestID := c.GetString(common.RequestIdKey)
	runner := newResponsesWSRequestRunner(c)
	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	if apiErr := responsesWSServe(c, ws, runner); apiErr != nil {
		logger.LogError(c, fmt.Sprintf("responses websocket relay error: %s", common.LocalLogPreview(apiErr.Error())))
		apiErr.SetMessage(common.MessageWithRequestId(apiErr.Error(), requestID))
		helper.WssError(c, ws, apiErr.ToOpenAIError())
	}
}

// responsesWSChannelFilter narrows channel selection to channels that speak
// the Responses WebSocket protocol with the per-channel toggle on. Advanced
// custom channels only qualify with a converter-free /v1/responses route.
func responsesWSChannelFilter() func(*appmodel.Channel) bool {
	return func(ch *appmodel.Channel) bool {
		if ch == nil || !ch.GetSetting().ResponsesWebSocketEnabled {
			return false
		}
		switch ch.Type {
		case constant.ChannelTypeOpenAI, constant.ChannelTypeCodex, constant.ChannelTypeSub2API, constant.ChannelTypeNewAPI:
			return true
		case constant.ChannelTypeAdvancedCustom:
			route, ok := ch.GetOtherSettings().AdvancedCustom.MatchPath("/v1/responses")
			return ok && (route.Converter == "" || route.Converter == dto.AdvancedCustomConverterNone)
		default:
			return false
		}
	}
}

func (s *responsesWSSession) runCall(c *gin.Context, state *responsesWSCallState, create responsesWSCreateRequest) (apiErr *types.NewAPIError) {
	modelName := create.Request.Model
	started := time.Now()
	var info *relaycommon.RelayInfo
	billingPrepared := false
	defer func() {
		if recovered := recover(); recovered != nil {
			apiErr = types.NewError(fmt.Errorf("responses websocket call panic: %v", recovered), types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
			state.closeAfter = true
		}
		if info == nil && modelName != "" {
			info = &relaycommon.RelayInfo{OriginModelName: modelName, UsingGroup: common.GetContextKeyString(c, constant.ContextKeyUsingGroup), StartTime: started}
		}
		if info != nil && billingPrepared && apiErr != nil {
			// Final-failure policy after all eligible attempts have ended. A
			// settled billing session never refunds again.
			apiErr = service.NormalizeViolationFeeError(apiErr)
			if info.Billing != nil {
				info.Billing.Refund(c)
			}
			service.ChargeViolationFeeIfNeeded(c, info, apiErr)
		}
	}()
	if modelName == "" {
		return newResponsesWSInvalidRequestError(errors.New("model is required"))
	}
	if s.lockedModel != "" && modelName != s.lockedModel {
		return newResponsesWSInvalidRequestError(fmt.Errorf("responses websocket connection is locked to model %q", s.lockedModel))
	}
	if apiErr = checkResponsesWSModelAccess(c, modelName); apiErr != nil {
		return apiErr
	}
	common.SetContextKey(c, constant.ContextKeyOriginalModel, modelName)
	common.SetContextKey(c, constant.ContextKeyRequestStartTime, time.Now())

	if s.lockedChannelID != 0 {
		if apiErr = s.restoreConnectionContext(c, modelName); apiErr != nil {
			return apiErr
		}
		info = relaycommon.GenRelayInfoResponses(c, &create.Request)
		info.IsStream = true
		common.SetContextKey(c, constant.ContextKeyIsStream, true)
		if apiErr = prepareResponsesWSBilling(c, info); apiErr != nil {
			return apiErr
		}
		billingPrepared = true
		var payload []byte
		payload, apiErr = buildResponsesWSCreatePayload(c, info, create)
		if apiErr != nil {
			return apiErr
		}
		if err := s.writeTarget(websocket.TextMessage, payload); err != nil {
			state.closeAfter = true
			return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}
	} else {
		usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
		retry := &service.RetryParam{
			Ctx:           c,
			TokenGroup:    usingGroup,
			ModelName:     modelName,
			RequestPath:   c.Request.URL.Path,
			Retry:         common.GetPointer(0),
			ChannelFilter: responsesWSChannelFilter(),
		}
		for ; retry.GetRetry() <= common.RetryTimes; retry.IncreaseRetry() {
			var channel *appmodel.Channel
			channel, _, selectErr := service.CacheGetRandomSatisfiedChannel(retry)
			if selectErr != nil {
				return types.NewError(fmt.Errorf("failed to get an available channel for model %s (retry): %s", modelName, selectErr.Error()), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
			}
			if channel == nil {
				return types.NewError(fmt.Errorf("no available channel for model %s with Responses WebSocket enabled (retry)", modelName), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
			}
			addUsedChannel(c, channel.Id)
			if apiErr = middleware.SetupContextForSelectedChannel(c, channel, modelName); apiErr != nil {
				return apiErr
			}
			if info == nil {
				info = relaycommon.GenRelayInfoResponses(c, &create.Request)
				info.IsStream = true
				common.SetContextKey(c, constant.ContextKeyIsStream, true)
				if apiErr = prepareResponsesWSBilling(c, info); apiErr != nil {
					return apiErr
				}
				billingPrepared = true
			}
			info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)
			info.RetryIndex = retry.GetRetry()
			var payload []byte
			payload, apiErr = buildResponsesWSCreatePayload(c, info, create)
			if apiErr != nil {
				return apiErr
			}
			adaptor := relay.GetAdaptor(info.ApiType)
			if adaptor == nil {
				return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
			}
			adaptor.Init(info)
			target, dialErr := relaychannel.DoWssRequest(adaptor, c, info, nil)
			if dialErr != nil {
				apiErr = types.NewError(dialErr, types.ErrorCodeDoRequestFailed)
				service.ResetStatusCode(apiErr, c.GetString("status_code_mapping"))
				info.LastError = apiErr
				processChannelError(c, channelErrorSnapshot(c, channel), apiErr)
				if shouldRetry(c, apiErr, common.RetryTimes-retry.GetRetry()) {
					continue
				}
				return apiErr
			}
			if !s.setTarget(target) {
				return types.NewError(context.Canceled, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
			}
			if err := s.writeTarget(websocket.TextMessage, payload); err != nil {
				state.closeAfter = true
				return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
			}
			s.lockedModel, s.lockedChannelID, s.lockedGroup = modelName, channel.Id, info.UsingGroup
			s.lockedKey = common.GetContextKeyString(c, constant.ContextKeyChannelKey)
			s.lockedKeyIndex = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
			s.lockedRoute, _ = channel.GetOtherSettings().AdvancedCustom.MatchPath(c.Request.URL.Path)
			s.lockedBaseURL = channel.GetBaseURL()
			s.lockedHeaderOverride = channel.GetHeaderOverride()
			s.lockedProxy = channel.GetSetting().Proxy
			s.registerChannelClose(channel.Id)
			s.startTargetReader(target)
			apiErr = nil
			break
		}
		if apiErr != nil {
			return apiErr
		}
	}

	accumulator := service.NewResponsesUsageAccumulator(c, info)
	info.StreamStatus = relaycommon.NewStreamStatus()
	common.SetContextKey(c, constant.ContextKeyIsStream, true)
	timeout := time.Duration(constant.StreamingTimeout) * time.Second
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	idle := time.NewTimer(timeout)
	defer idle.Stop()
	accepted := false
	var pendingControl []byte
	var sentControl []byte
	var responseID string
	for {
		select {
		case incoming := <-state.inbox:
			idle.Reset(timeout)
			if incoming.err != nil {
				info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonScannerErr, incoming.err)
				state.closeAfter = true
				consumeResponsesWSQuota(c, info, accumulator.Finish())
				return nil
			}
			info.SetFirstResponseTime()
			var event struct {
				dto.ResponsesStreamResponse
				StreamID string `json:"stream_id"`
			}
			if err := common.Unmarshal(incoming.body, &event); err != nil {
				info.StreamStatus.RecordError("invalid upstream websocket event")
			} else {
				if event.Type != "error" && event.StreamID != "" && event.StreamID != create.StreamID {
					if err := s.writeClient(incoming.kind, incoming.body); err != nil {
						s.shutdown()
					}
					continue
				}
				// A repeated terminal from the previous response must never finish
				// a subsequent request on this persistent connection.
				if event.Response != nil && event.Response.ID != "" && event.Response.ID == s.lastResponseID {
					continue
				}
				if event.Type == "error" {
					var rejection responsesWSErrorEvent
					_ = common.Unmarshal(incoming.body, &rejection)
					if rejection.ResponseID != "" && rejection.ResponseID == s.lastResponseID {
						continue
					}
					terminal, ambiguous, controlError := responsesWSErrorEndsRequest(rejection, create.StreamID, responseID, sentControl)
					if !terminal {
						if err := s.writeClient(incoming.kind, incoming.body); err != nil {
							s.shutdown()
						}
						// Only a control error in this stream resolves its pending control.
						if controlError {
							sentControl = nil
						}
						continue
					}
					if accepted {
						if rejection.Error != nil {
							code := ""
							if rejection.Error.Code != nil {
								code = fmt.Sprint(rejection.Error.Code)
							}
							info.StreamStatus.RecordError(fmt.Sprintf("upstream error %s", code))
						}
						accumulator.Observe(&event.ResponsesStreamResponse)
						info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonDone, nil)
						s.lastResponseID = responseID
						state.terminal, state.closeAfter = &incoming, ambiguous
						consumeResponsesWSQuota(c, info, accumulator.Finish())
						return nil
					}
					if rejection.Error == nil {
						// An error frame without an error object still describes the
						// rejected request; keep the client-facing type stable.
						rejection.Error = &types.OpenAIError{Type: "invalid_request_error", Message: event.Message, Code: event.Code}
					}
					rejected := types.WithOpenAIError(*rejection.Error, rejection.Status, types.ErrOptionWithSkipRetry())
					if rejected.StatusCode < 400 || rejected.StatusCode > 599 {
						rejected.StatusCode = http.StatusBadRequest
					}
					return rejected
				}
				if strings.HasPrefix(event.Type, "response.") {
					if !accepted {
						// Like HTTP, bind the session only once upstream accepted the request.
						service.RecordChannelAffinity(c, s.lockedChannelID)
					}
					accepted = true
					if event.Response != nil && event.Response.ID != "" {
						responseID = event.Response.ID
					}
				}
				accumulator.Observe(&event.ResponsesStreamResponse)
			}
			switch event.Type {
			case "response.completed", "response.done", "response.incomplete", "response.failed", "response.cancelled", "response.canceled":
				if event.Response != nil {
					s.lastResponseID = event.Response.ID
				}
				info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonDone, nil)
				state.terminal = &incoming
				consumeResponsesWSQuota(c, info, accumulator.Finish())
				return nil
			}
			if err := s.writeClient(incoming.kind, incoming.body); err != nil {
				s.shutdown()
			}
			if accepted && pendingControl != nil {
				if err := s.writeTarget(websocket.TextMessage, pendingControl); err != nil {
					s.shutdown()
				}
				sentControl = pendingControl
				pendingControl = nil
			}
		case control := <-state.controls:
			if pendingControl != nil || sentControl != nil {
				s.sendError(control.eventID, control.streamID, newResponsesWSInvalidRequestError(errors.New("a response control event is already pending")))
				continue
			}
			if !accepted {
				pendingControl = control.body
				continue
			}
			if err := s.writeTarget(websocket.TextMessage, control.body); err != nil {
				s.shutdown()
			}
			sentControl = control.body
		case <-idle.C:
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonTimeout, context.DeadlineExceeded)
			state.closeAfter = true
			consumeResponsesWSQuota(c, info, accumulator.Finish())
			return nil
		case <-s.ctx.Done():
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, s.ctx.Err())
			consumeResponsesWSQuota(c, info, accumulator.Finish())
			return nil
		}
	}
}

// prepareResponsesWSBilling estimates and reserves one response.create charge
// with the same sensitive-check, token estimation and pre-consume rules as the
// HTTP relay pipeline.
func prepareResponsesWSBilling(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	needSensitiveCheck := setting.ShouldCheckPromptSensitive()
	needCountToken := constant.CountToken
	// Avoid building huge CombineText (strings.Join) when token counting and sensitive check are both disabled.
	var meta *types.TokenCountMeta
	if needSensitiveCheck || needCountToken {
		meta = info.Request.GetTokenCountMeta()
	} else {
		meta = fastTokenCountMetaForPricing(info.Request)
	}
	if needSensitiveCheck && meta != nil {
		if contains, words := service.CheckSensitiveText(meta.CombineText); contains {
			message := fmt.Sprintf("user sensitive words detected: %s", strings.Join(words, ", "))
			logger.LogWarn(c, message)
			return types.NewError(errors.New(message), types.ErrorCodeSensitiveWordsDetected, types.ErrOptionWithStatusCode(http.StatusBadRequest), types.ErrOptionWithSkipRetry())
		}
	}
	tokens, err := service.EstimateRequestToken(c, meta, info)
	if err != nil {
		return types.NewError(err, types.ErrorCodeCountTokenFailed)
	}
	info.SetEstimatePromptTokens(tokens)
	priceData, err := helper.ModelPriceHelper(c, info, tokens, meta)
	if err != nil {
		return types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
	}
	if priceData.FreeModel {
		logger.LogInfo(c, fmt.Sprintf("模型 %s 免费，跳过预扣费", info.OriginModelName))
		return nil
	}
	return service.PreConsumeBilling(c, priceData.QuotaToPreConsume, info)
}

// consumeResponsesWSQuota settles one response.create with the same post
// consumption path as the HTTP Responses relay.
func consumeResponsesWSQuota(c *gin.Context, info *relaycommon.RelayInfo, usage *dto.Usage) {
	if strings.HasPrefix(info.OriginModelName, "gpt-4o-audio") {
		service.PostAudioConsumeQuota(c, info, usage, "")
	} else {
		service.PostTextConsumeQuota(c, info, usage, nil)
	}
}
