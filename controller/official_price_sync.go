package controller

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

const (
	officialPriceSourceModelsDev = "models.dev"
	officialPriceSourceBaseLLM   = "basellm"
	officialRatioPresetEndpoint  = "/llm-metadata/api/newapi/ratio_config-v1-base.json"
)

var modelsDevOfficialProviders = map[string]struct{}{
	"ai21":       {},
	"alibaba":    {},
	"amazon":     {},
	"anthropic":  {},
	"baidu":      {},
	"cloudflare": {},
	"cohere":     {},
	"dashscope":  {},
	"deepseek":   {},
	"google":     {},
	"groq":       {},
	"mistral":    {},
	"mistralai":  {},
	"moonshot":   {},
	"moonshotai": {},
	"openai":     {},
	"perplexity": {},
	"qwen":       {},
	"stepfun":    {},
	"tencent":    {},
	"vertex":     {},
	"volcengine": {},
	"voyage":     {},
	"workers-ai": {},
	"xai":        {},
	"x-ai":       {},
	"z-ai":       {},
	"zai":        {},
	"zhipu":      {},
}

var knownModelProviderPrefixes = []string{
	"ai21",
	"alibaba",
	"amazon",
	"anthropic",
	"azure",
	"baidu",
	"bedrock",
	"cloudflare",
	"cohere",
	"dashscope",
	"deepseek",
	"gemini",
	"google",
	"groq",
	"mistral",
	"mistralai",
	"moonshot",
	"moonshotai",
	"openai",
	"perplexity",
	"qwen",
	"stepfun",
	"tencent",
	"vertex",
	"volcengine",
	"voyage",
	"workers-ai",
	"x-ai",
	"xai",
	"z-ai",
	"zai",
	"zhipu",
}

type officialPriceEntry struct {
	Source         string
	Provider       string
	UpstreamModel  string
	Fields         map[string]any
	InputPrice     *float64
	OutputPrice    *float64
	CacheReadPrice *float64
}

type officialPriceSource struct {
	Name string
	URL  string
}

var officialPriceSources = []officialPriceSource{
	{
		Name: officialPriceSourceModelsDev,
		URL:  modelsDevPresetBaseURL + modelsDevPath,
	},
	{
		Name: officialPriceSourceBaseLLM,
		URL:  officialRatioPresetBaseURL + officialRatioPresetEndpoint,
	},
}

func GetOfficialPriceMappings(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    loadOfficialPriceMappings(),
	})
}

func PreviewOfficialPriceSync(c *gin.Context) {
	previewOfficialPriceSync(
		c,
		previewOfficialPriceSourceNames(c.Query("sources")),
		nil,
	)
}

func PreviewSelectedOfficialPriceSync(c *gin.Context) {
	var req dto.OfficialPricePreviewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求参数格式错误"})
		return
	}

	previewOfficialPriceSync(
		c,
		previewOfficialPriceSourceNamesFromSlice(req.Sources),
		req.ModelNames,
	)
}

func previewOfficialPriceSync(c *gin.Context, sourceNames, requestedModelNames []string) {
	timeoutSec := common.GetEnvOrDefault("SYNC_HTTP_TIMEOUT_SECONDS", defaultTimeoutSeconds)
	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	entries, sourceResults := fetchOfficialPriceEntries(ctx, sourceNames)
	mappings := loadOfficialPriceMappings()
	localData := getLocalPricingSyncData()
	pricingByModel := getPricingByModel()

	localModels := collectOfficialPriceLocalModels(localData, pricingByModel)
	localModels = filterOfficialPriceLocalModels(localModels, requestedModelNames)
	models := make([]dto.OfficialPriceModelPreview, 0, len(localModels))
	for _, modelName := range localModels {
		var mapping *dto.OfficialPriceMapping
		if saved, ok := mappings[modelName]; ok {
			savedCopy := saved
			mapping = &savedCopy
		}

		models = append(models, dto.OfficialPriceModelPreview{
			ModelName:  modelName,
			Current:    currentOfficialPriceFields(localData, pricingByModel, modelName),
			Mapping:    mapping,
			Candidates: buildOfficialPriceCandidates(modelName, entries, mapping),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": dto.OfficialPricePreviewData{
			Models:        models,
			Mappings:      mappings,
			SourceResults: sourceResults,
		},
	})
}

func ApplyOfficialPriceSync(c *gin.Context) {
	var req dto.OfficialPriceApplyRequest
	_ = c.ShouldBindJSON(&req)

	existingMappings := loadOfficialPriceMappings()
	for localModel, mapping := range req.Mappings {
		if strings.TrimSpace(mapping.Source) == "" || strings.TrimSpace(mapping.UpstreamModel) == "" {
			delete(existingMappings, localModel)
			continue
		}
		existingMappings[localModel] = normalizeOfficialPriceMapping(mapping)
	}

	targetMappings := req.Mappings
	if req.ApplyAll || len(targetMappings) == 0 {
		targetMappings = existingMappings
	}
	if len(targetMappings) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "没有可同步的官方价格映射",
		})
		return
	}

	timeoutSec := common.GetEnvOrDefault("SYNC_HTTP_TIMEOUT_SECONDS", defaultTimeoutSeconds)
	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	entries, sourceResults := fetchOfficialPriceEntries(
		ctx,
		officialPriceMappingSourceNames(targetMappings),
	)
	entryByKey := make(map[string]officialPriceEntry, len(entries))
	for _, entry := range entries {
		entryByKey[officialPriceEntryKey(entry.Source, entry.Provider, entry.UpstreamModel)] = entry
	}

	pricingMaps := cloneLocalPricingMaps(getLocalPricingSyncData())
	updatedModels := make([]string, 0, len(targetMappings))
	skippedModels := make([]string, 0)
	updatedFields := make(map[string]map[string]any)

	for localModel, mapping := range targetMappings {
		normalized := normalizeOfficialPriceMapping(mapping)
		entry, ok := entryByKey[officialPriceMappingKey(normalized)]
		if !ok {
			skippedModels = append(skippedModels, localModel)
			continue
		}
		applyOfficialPriceEntry(pricingMaps, localModel, entry)
		updatedModels = append(updatedModels, localModel)
		updatedFields[localModel] = entry.Fields
		existingMappings[localModel] = normalized
	}

	if len(updatedModels) == 0 && len(req.Mappings) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "没有找到可应用的官方价格",
			"data": dto.OfficialPriceApplyData{
				SkippedModels: skippedModels,
				Mappings:      existingMappings,
				SourceResults: sourceResults,
			},
		})
		return
	}

	updates, err := buildOfficialPriceOptionUpdates(pricingMaps, existingMappings)
	if err != nil {
		common.SysError("failed to build official price updates: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "构建官方价格同步配置失败"})
		return
	}
	if err := model.UpdateOptionsBulk(updates); err != nil {
		common.SysError("failed to save official price updates: " + err.Error())
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "保存官方价格同步配置失败"})
		return
	}
	model.InvalidatePricingCache()

	sort.Strings(updatedModels)
	sort.Strings(skippedModels)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": dto.OfficialPriceApplyData{
			UpdatedModels: updatedModels,
			SkippedModels: skippedModels,
			Mappings:      existingMappings,
			SourceResults: sourceResults,
			UpdatedFields: updatedFields,
		},
	})
}

func loadOfficialPriceMappings() map[string]dto.OfficialPriceMapping {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[model.OfficialPriceModelMappingsOptionKey]
	common.OptionMapRWMutex.RUnlock()

	if strings.TrimSpace(raw) == "" {
		return map[string]dto.OfficialPriceMapping{}
	}

	var mappings map[string]dto.OfficialPriceMapping
	if err := common.UnmarshalJsonStr(raw, &mappings); err != nil {
		common.SysError("failed to parse official price mappings: " + err.Error())
		return map[string]dto.OfficialPriceMapping{}
	}
	for localModel, mapping := range mappings {
		if strings.TrimSpace(localModel) == "" || strings.TrimSpace(mapping.Source) == "" || strings.TrimSpace(mapping.UpstreamModel) == "" {
			delete(mappings, localModel)
			continue
		}
		mappings[localModel] = normalizeOfficialPriceMapping(mapping)
	}
	return mappings
}

func normalizeOfficialPriceMapping(mapping dto.OfficialPriceMapping) dto.OfficialPriceMapping {
	return dto.OfficialPriceMapping{
		Source:        strings.TrimSpace(mapping.Source),
		Provider:      strings.TrimSpace(mapping.Provider),
		UpstreamModel: strings.TrimSpace(mapping.UpstreamModel),
	}
}

func previewOfficialPriceSourceNames(rawSources string) []string {
	if strings.TrimSpace(rawSources) == "" {
		return allOfficialPriceSourceNames()
	}

	return officialPriceSourceNames([]string{rawSources})
}

func previewOfficialPriceSourceNamesFromSlice(sourceNames []string) []string {
	for _, sourceName := range sourceNames {
		if strings.TrimSpace(sourceName) != "" {
			return officialPriceSourceNames(sourceNames)
		}
	}
	return allOfficialPriceSourceNames()
}

func allOfficialPriceSourceNames() []string {
	sourceNames := make([]string, 0, len(officialPriceSources))
	for _, source := range officialPriceSources {
		sourceNames = append(sourceNames, source.Name)
	}
	return sourceNames
}

func officialPriceMappingSourceNames(mappings map[string]dto.OfficialPriceMapping) []string {
	sourceNames := make([]string, 0, len(mappings))
	for _, mapping := range mappings {
		sourceNames = append(sourceNames, mapping.Source)
	}
	return officialPriceSourceNames(sourceNames)
}

func officialPriceSourceNames(values []string) []string {
	requestedSources := make(map[string]struct{})
	for _, value := range values {
		for _, sourceName := range strings.Split(value, ",") {
			sourceName = strings.TrimSpace(sourceName)
			if sourceName != "" {
				requestedSources[sourceName] = struct{}{}
			}
		}
	}

	sourceNames := make([]string, 0, len(requestedSources))
	for _, source := range officialPriceSources {
		if _, ok := requestedSources[source.Name]; ok {
			sourceNames = append(sourceNames, source.Name)
		}
	}
	return sourceNames
}

func fetchOfficialPriceEntries(ctx context.Context, sourceNames []string) ([]officialPriceEntry, []dto.OfficialPriceSourceResult) {
	selectedSources := make(map[string]struct{}, len(sourceNames))
	for _, sourceName := range sourceNames {
		selectedSources[sourceName] = struct{}{}
	}

	client := officialPriceHTTPClient()
	entries := make([]officialPriceEntry, 0)
	results := make([]dto.OfficialPriceSourceResult, 0, len(sourceNames))
	for _, source := range officialPriceSources {
		if _, ok := selectedSources[source.Name]; !ok {
			continue
		}

		body, err := fetchOfficialPriceSource(ctx, client, source.URL)
		if err != nil {
			logger.LogWarn(ctx, "official price source fetch failed: "+source.Name+": "+err.Error())
			results = append(results, dto.OfficialPriceSourceResult{Name: source.Name, Status: "error", Error: err.Error()})
			continue
		}

		var parsed []officialPriceEntry
		switch source.Name {
		case officialPriceSourceModelsDev:
			parsed, err = parseModelsDevOfficialPriceEntries(bytes.NewReader(body))
		case officialPriceSourceBaseLLM:
			parsed, err = parseBaseLLMOfficialPriceEntries(bytes.NewReader(body))
		}
		if err != nil {
			logger.LogWarn(ctx, "official price source parse failed: "+source.Name+": "+err.Error())
			results = append(results, dto.OfficialPriceSourceResult{Name: source.Name, Status: "error", Error: err.Error()})
			continue
		}
		entries = append(entries, parsed...)
		results = append(results, dto.OfficialPriceSourceResult{Name: source.Name, Status: "success", Count: len(parsed)})
	}
	return entries, results
}

func officialPriceHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{
		MaxIdleConns:          20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second,
	}
	if common.TLSInsecureSkipVerify {
		transport.TLSClientConfig = common.InsecureTLSConfig
	}
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			host = addr
		}
		if strings.HasSuffix(host, "github.io") {
			if conn, err := dialer.DialContext(ctx, "tcp4", addr); err == nil {
				return conn, nil
			}
			return dialer.DialContext(ctx, "tcp6", addr)
		}
		return dialer.DialContext(ctx, network, addr)
	}
	return &http.Client{Transport: transport}
}

func fetchOfficialPriceSource(ctx context.Context, client *http.Client, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %s", resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, maxRatioConfigBytes))
}

func parseModelsDevOfficialPriceEntries(reader io.Reader) ([]officialPriceEntry, error) {
	var upstreamData map[string]modelsDevProvider
	if err := common.DecodeJson(reader, &upstreamData); err != nil {
		return nil, fmt.Errorf("failed to decode models.dev response: %w", err)
	}
	if len(upstreamData) == 0 {
		return nil, fmt.Errorf("empty models.dev response")
	}

	providers := make([]string, 0, len(upstreamData))
	for provider := range upstreamData {
		if _, ok := modelsDevOfficialProviders[provider]; ok {
			providers = append(providers, provider)
		}
	}
	sort.Strings(providers)

	entries := make([]officialPriceEntry, 0)
	for _, provider := range providers {
		providerData := upstreamData[provider]
		modelNames := make([]string, 0, len(providerData.Models))
		for modelName := range providerData.Models {
			modelNames = append(modelNames, modelName)
		}
		sort.Strings(modelNames)

		for _, modelName := range modelNames {
			candidate, ok := buildModelsDevCandidate(provider, providerData.Models[modelName].Cost)
			if !ok {
				continue
			}
			fields := modelsDevCandidateFields(candidate)
			if len(fields) == 0 {
				continue
			}
			entries = append(entries, officialPriceEntry{
				Source:         officialPriceSourceModelsDev,
				Provider:       provider,
				UpstreamModel:  modelName,
				Fields:         fields,
				InputPrice:     cloneFloatPtr(&candidate.Input),
				OutputPrice:    cloneFloatPtr(candidate.Output),
				CacheReadPrice: cloneFloatPtr(candidate.CacheRead),
			})
		}
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("no valid official models.dev pricing entries found")
	}
	return entries, nil
}

func modelsDevCandidateFields(candidate modelsDevCandidate) map[string]any {
	fields := make(map[string]any)
	if candidate.Input == 0 {
		fields["model_ratio"] = 0.0
		return fields
	}

	modelRatio := candidate.Input * float64(ratio_setting.USD) / modelsDevInputCostRatioBase
	fields["model_ratio"] = roundRatioValue(modelRatio)

	if candidate.Output != nil {
		fields["completion_ratio"] = roundRatioValue(*candidate.Output / candidate.Input)
	}
	if candidate.CacheRead != nil {
		fields["cache_ratio"] = roundRatioValue(*candidate.CacheRead / candidate.Input)
	}
	return fields
}

func parseBaseLLMOfficialPriceEntries(reader io.Reader) ([]officialPriceEntry, error) {
	var body struct {
		Success bool           `json:"success"`
		Data    map[string]any `json:"data"`
		Message string         `json:"message"`
	}
	if err := common.DecodeJson(reader, &body); err != nil {
		return nil, fmt.Errorf("failed to decode basellm response: %w", err)
	}
	if !body.Success {
		return nil, fmt.Errorf("basellm error: %s", body.Message)
	}

	byModel := make(map[string]officialPriceEntry)
	for _, field := range pricingSyncFields {
		for modelName, value := range valueMap(body.Data[field]) {
			entry := byModel[modelName]
			if entry.Fields == nil {
				entry = officialPriceEntry{
					Source:        officialPriceSourceBaseLLM,
					Provider:      inferProviderFromModelName(modelName),
					UpstreamModel: modelName,
					Fields:        make(map[string]any),
				}
			}
			entry.Fields[field] = normalizeSyncValue(field, value)
			byModel[modelName] = entry
		}
	}

	modelNames := make([]string, 0, len(byModel))
	for modelName := range byModel {
		modelNames = append(modelNames, modelName)
	}
	sort.Strings(modelNames)

	entries := make([]officialPriceEntry, 0, len(modelNames))
	for _, modelName := range modelNames {
		entries = append(entries, byModel[modelName])
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("empty basellm pricing data")
	}
	return entries, nil
}

func getPricingByModel() map[string]model.Pricing {
	pricings := model.GetPricing()
	byModel := make(map[string]model.Pricing, len(pricings))
	for _, pricing := range pricings {
		if pricing.ModelName != "" {
			byModel[pricing.ModelName] = pricing
		}
	}
	return byModel
}

func collectOfficialPriceLocalModels(localData map[string]any, pricingByModel map[string]model.Pricing) []string {
	var metas []model.Model
	_ = model.DB.Select("model_name").Where("status = ? AND sync_official <> 0 AND name_rule = ?", 1, model.NameRuleExact).Find(&metas).Error

	syncOfficialModels := make([]string, 0, len(metas))
	for _, meta := range metas {
		syncOfficialModels = append(syncOfficialModels, meta.ModelName)
	}
	enabledChannelModels, _ := model.GetEnabledChannelModelNames()

	return mergeOfficialPriceLocalModelNames(
		localData,
		pricingByModel,
		enabledChannelModels,
		syncOfficialModels,
	)
}

func filterOfficialPriceLocalModels(localModels, requestedModels []string) []string {
	if len(requestedModels) == 0 {
		return localModels
	}

	requestedSet := make(map[string]struct{}, len(requestedModels))
	for _, modelName := range requestedModels {
		if modelName = strings.TrimSpace(modelName); modelName != "" {
			requestedSet[modelName] = struct{}{}
		}
	}

	filteredModels := make([]string, 0, len(requestedSet))
	for _, modelName := range localModels {
		if _, ok := requestedSet[modelName]; ok {
			filteredModels = append(filteredModels, modelName)
		}
	}
	return filteredModels
}

func mergeOfficialPriceLocalModelNames(
	localData map[string]any,
	pricingByModel map[string]model.Pricing,
	enabledModels []string,
	syncOfficialModels []string,
) []string {
	modelSet := make(map[string]struct{})
	for _, field := range pricingSyncFields {
		for modelName := range valueMap(localData[field]) {
			if strings.TrimSpace(modelName) != "" {
				modelSet[modelName] = struct{}{}
			}
		}
	}
	for modelName := range pricingByModel {
		if strings.TrimSpace(modelName) != "" {
			modelSet[modelName] = struct{}{}
		}
	}
	for _, modelName := range enabledModels {
		if strings.TrimSpace(modelName) != "" {
			modelSet[modelName] = struct{}{}
		}
	}
	for _, modelName := range syncOfficialModels {
		if strings.TrimSpace(modelName) != "" {
			modelSet[modelName] = struct{}{}
		}
	}

	modelNames := make([]string, 0, len(modelSet))
	for modelName := range modelSet {
		modelNames = append(modelNames, modelName)
	}
	sort.Strings(modelNames)
	return modelNames
}

func currentOfficialPriceFields(localData map[string]any, pricingByModel map[string]model.Pricing, modelName string) map[string]any {
	current := make(map[string]any)
	if pricing, ok := pricingByModel[modelName]; ok {
		if pricing.QuotaType == 1 {
			current["model_price"] = pricing.ModelPrice
		} else {
			current["model_ratio"] = pricing.ModelRatio
			current["completion_ratio"] = pricing.CompletionRatio
		}
		if pricing.CacheRatio != nil {
			current["cache_ratio"] = *pricing.CacheRatio
		}
		if pricing.CreateCacheRatio != nil {
			current["create_cache_ratio"] = *pricing.CreateCacheRatio
		}
		if pricing.ImageRatio != nil {
			current["image_ratio"] = *pricing.ImageRatio
		}
		if pricing.AudioRatio != nil {
			current["audio_ratio"] = *pricing.AudioRatio
		}
		if pricing.AudioCompletionRatio != nil {
			current["audio_completion_ratio"] = *pricing.AudioCompletionRatio
		}
		if strings.TrimSpace(pricing.BillingExpr) != "" {
			current["billing_mode"] = pricing.BillingMode
			current["billing_expr"] = pricing.BillingExpr
		}
	}

	for _, field := range pricingSyncFields {
		if value, ok := valueMap(localData[field])[modelName]; ok {
			current[field] = normalizeSyncValue(field, value)
		}
	}
	return current
}

func buildOfficialPriceCandidates(modelName string, entries []officialPriceEntry, mapping *dto.OfficialPriceMapping) []dto.OfficialPriceCandidate {
	candidates := make([]dto.OfficialPriceCandidate, 0)
	seen := make(map[string]int)
	for _, entry := range entries {
		score, reasons := scoreOfficialPriceCandidate(modelName, entry)
		selected := false
		if mapping != nil && officialPriceEntryKey(entry.Source, entry.Provider, entry.UpstreamModel) == officialPriceMappingKey(*mapping) {
			selected = true
			if score == 0 {
				score = 1
				reasons = append(reasons, "saved mapping")
			}
		}
		if score == 0 {
			continue
		}

		candidate := dto.OfficialPriceCandidate{
			Source:         entry.Source,
			Provider:       entry.Provider,
			UpstreamModel:  entry.UpstreamModel,
			Fields:         entry.Fields,
			InputPrice:     cloneFloatPtr(entry.InputPrice),
			OutputPrice:    cloneFloatPtr(entry.OutputPrice),
			CacheReadPrice: cloneFloatPtr(entry.CacheReadPrice),
			Score:          score,
			Reasons:        reasons,
			Selected:       selected,
		}
		key := officialPriceMappingKey(dto.OfficialPriceMapping{
			Source:        candidate.Source,
			Provider:      candidate.Provider,
			UpstreamModel: candidate.UpstreamModel,
		})
		if existingIdx, ok := seen[key]; ok {
			if shouldReplaceOfficialCandidate(candidates[existingIdx], candidate) {
				candidates[existingIdx] = candidate
			}
			continue
		}
		seen[key] = len(candidates)
		candidates = append(candidates, candidate)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		left, right := candidates[i], candidates[j]
		if left.Selected != right.Selected {
			return left.Selected
		}
		if left.Score != right.Score {
			return left.Score > right.Score
		}
		if sourcePriority(left.Source) != sourcePriority(right.Source) {
			return sourcePriority(left.Source) > sourcePriority(right.Source)
		}
		if left.Provider != right.Provider {
			return left.Provider < right.Provider
		}
		return left.UpstreamModel < right.UpstreamModel
	})
	return candidates
}

func scoreOfficialPriceCandidate(localModel string, entry officialPriceEntry) (int, []string) {
	localTrimmed := strings.TrimSpace(localModel)
	upstreamTrimmed := strings.TrimSpace(entry.UpstreamModel)
	if localTrimmed == "" || upstreamTrimmed == "" {
		return 0, nil
	}
	if localTrimmed == upstreamTrimmed {
		return 100 + sourcePriority(entry.Source), []string{"exact name"}
	}

	localFull := compactModelKey(localTrimmed)
	upstreamFull := compactModelKey(upstreamTrimmed)
	if localFull != "" && localFull == upstreamFull {
		return 96 + sourcePriority(entry.Source), []string{"normalized name"}
	}

	localBase := baseModelKey(localTrimmed)
	upstreamBase := baseModelKey(upstreamTrimmed)
	if localBase != "" && localBase == upstreamBase {
		return 90 + sourcePriority(entry.Source), []string{"provider prefix stripped"}
	}

	localNoDate := stripDateVersion(localBase)
	upstreamNoDate := stripDateVersion(upstreamBase)
	if localNoDate != "" && localNoDate == upstreamNoDate {
		return 78 + sourcePriority(entry.Source), []string{"version suffix stripped"}
	}

	if localFull != "" && strings.HasSuffix(upstreamFull, "-"+localFull) {
		return 70 + sourcePriority(entry.Source), []string{"upstream has prefix"}
	}
	if upstreamFull != "" && strings.HasSuffix(localFull, "-"+upstreamFull) {
		return 68 + sourcePriority(entry.Source), []string{"local model has prefix"}
	}
	return 0, nil
}

func shouldReplaceOfficialCandidate(current, next dto.OfficialPriceCandidate) bool {
	if current.Selected != next.Selected {
		return next.Selected
	}
	if current.Score != next.Score {
		return next.Score > current.Score
	}
	return sourcePriority(next.Source) > sourcePriority(current.Source)
}

func cloneLocalPricingMaps(localData map[string]any) map[string]map[string]any {
	out := make(map[string]map[string]any, len(pricingSyncFields))
	for _, field := range pricingSyncFields {
		values := valueMap(localData[field])
		copied := make(map[string]any, len(values))
		for modelName, value := range values {
			copied[modelName] = normalizeSyncValue(field, value)
		}
		out[field] = copied
	}
	return out
}

func applyOfficialPriceEntry(pricingMaps map[string]map[string]any, localModel string, entry officialPriceEntry) {
	hasModelPrice := false
	hasRatioPrice := false
	for field := range entry.Fields {
		if field == "model_price" {
			hasModelPrice = true
		}
		if field != "model_price" && field != billing_setting.BillingModeField && field != billing_setting.BillingExprField {
			hasRatioPrice = true
		}
	}

	if hasModelPrice {
		for _, field := range []string{"model_ratio", "completion_ratio", "cache_ratio", "create_cache_ratio", "image_ratio", "audio_ratio", "audio_completion_ratio"} {
			delete(pricingMaps[field], localModel)
		}
	}
	if hasRatioPrice {
		delete(pricingMaps["model_price"], localModel)
	}

	for field, value := range entry.Fields {
		if pricingMaps[field] == nil {
			continue
		}
		pricingMaps[field][localModel] = normalizeSyncValue(field, value)
	}
}

func buildOfficialPriceOptionUpdates(pricingMaps map[string]map[string]any, mappings map[string]dto.OfficialPriceMapping) (map[string]string, error) {
	updates := make(map[string]string, len(pricingSyncFields)+1)
	for _, field := range pricingSyncFields {
		optionKey := optionKeyByOfficialPriceField(field)
		data, err := common.Marshal(pricingMaps[field])
		if err != nil {
			return nil, err
		}
		updates[optionKey] = string(data)
	}

	data, err := common.Marshal(mappings)
	if err != nil {
		return nil, err
	}
	updates[model.OfficialPriceModelMappingsOptionKey] = string(data)
	return updates, nil
}

func optionKeyByOfficialPriceField(field string) string {
	switch field {
	case "model_ratio":
		return "ModelRatio"
	case "completion_ratio":
		return "CompletionRatio"
	case "cache_ratio":
		return "CacheRatio"
	case "create_cache_ratio":
		return "CreateCacheRatio"
	case "image_ratio":
		return "ImageRatio"
	case "audio_ratio":
		return "AudioRatio"
	case "audio_completion_ratio":
		return "AudioCompletionRatio"
	case "model_price":
		return "ModelPrice"
	case "billing_mode":
		return "billing_setting.billing_mode"
	case "billing_expr":
		return "billing_setting.billing_expr"
	default:
		return field
	}
}

func officialPriceMappingKey(mapping dto.OfficialPriceMapping) string {
	return officialPriceEntryKey(mapping.Source, mapping.Provider, mapping.UpstreamModel)
}

func officialPriceEntryKey(source, provider, upstreamModel string) string {
	return strings.TrimSpace(source) + "\x00" + strings.TrimSpace(provider) + "\x00" + strings.TrimSpace(upstreamModel)
}

func sourcePriority(source string) int {
	switch source {
	case officialPriceSourceModelsDev:
		return 4
	case officialPriceSourceBaseLLM:
		return 2
	default:
		return 0
	}
}

func inferProviderFromModelName(modelName string) string {
	name := strings.ToLower(strings.TrimSpace(modelName))
	if idx := strings.LastIndex(name, "/models/"); idx >= 0 {
		prefix := strings.Trim(name[:idx], "/")
		if slash := strings.LastIndex(prefix, "/"); slash >= 0 {
			return prefix[slash+1:]
		}
		return prefix
	}
	if idx := strings.Index(name, "/"); idx > 0 {
		return name[:idx]
	}
	key := compactModelKey(name)
	for _, prefix := range knownModelProviderPrefixes {
		if strings.HasPrefix(key, prefix+"-") {
			return prefix
		}
	}
	return ""
}

func baseModelKey(modelName string) string {
	name := strings.ToLower(strings.TrimSpace(modelName))
	if idx := strings.LastIndex(name, "/models/"); idx >= 0 {
		name = name[idx+len("/models/"):]
	} else if idx := strings.LastIndex(name, "/"); idx >= 0 {
		name = name[idx+1:]
	}

	key := compactModelKey(name)
	changed := true
	for changed {
		changed = false
		for _, prefix := range knownModelProviderPrefixes {
			if strings.HasPrefix(key, prefix+"-") {
				key = strings.TrimPrefix(key, prefix+"-")
				changed = true
			}
		}
	}
	return key
}

func compactModelKey(modelName string) string {
	var builder strings.Builder
	lastDash := false
	for _, r := range strings.ToLower(strings.TrimSpace(modelName)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func stripDateVersion(value string) string {
	parts := strings.Split(value, "-")
	out := make([]string, 0, len(parts))
	for i := 0; i < len(parts); i++ {
		if i+2 < len(parts) && isFourDigitYear(parts[i]) && isTwoDigitNumber(parts[i+1]) && isTwoDigitNumber(parts[i+2]) {
			i += 2
			continue
		}
		if len(parts[i]) == 8 && isNumericString(parts[i]) && strings.HasPrefix(parts[i], "20") {
			continue
		}
		out = append(out, parts[i])
	}
	return strings.Join(out, "-")
}

func isFourDigitYear(value string) bool {
	return len(value) == 4 && strings.HasPrefix(value, "20") && isNumericString(value)
}

func isTwoDigitNumber(value string) bool {
	return len(value) == 2 && isNumericString(value)
}

func isNumericString(value string) bool {
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return value != ""
}
