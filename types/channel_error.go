package types

// ChannelAutoBanRules overrides the global automatic-disable rules for a single
// channel. A nil rules pointer means the channel follows the global status-code
// and keyword settings; a non-nil pointer completely replaces both.
type ChannelAutoBanRules struct {
	StatusCodes string   `json:"status_codes,omitempty"`
	Keywords    []string `json:"keywords,omitempty"`
}

type ChannelError struct {
	ChannelId    int                  `json:"channel_id"`
	ChannelType  int                  `json:"channel_type"`
	ChannelName  string               `json:"channel_name"`
	IsMultiKey   bool                 `json:"is_multi_key"`
	AutoBanMode  int                  `json:"auto_ban_mode"`
	AutoBanRules *ChannelAutoBanRules `json:"auto_ban_rules,omitempty"`
	UsingKey     string               `json:"using_key"`
}

func NewChannelError(channelId int, channelType int, channelName string, isMultiKey bool, usingKey string, autoBanMode int, autoBanRules *ChannelAutoBanRules) *ChannelError {
	return &ChannelError{
		ChannelId:    channelId,
		ChannelType:  channelType,
		ChannelName:  channelName,
		IsMultiKey:   isMultiKey,
		AutoBanMode:  autoBanMode,
		AutoBanRules: autoBanRules,
		UsingKey:     usingKey,
	}
}
