package constant

type MultiKeyMode string

const (
	MultiKeyModeRandom   MultiKeyMode = "random"   // 随机
	MultiKeyModePolling  MultiKeyMode = "polling"  // 轮询
	MultiKeyModeFailover MultiKeyMode = "failover" // 粘滞主备：驻留当前 key，被禁用后才切下一把
)
