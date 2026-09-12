package ratio_setting

import (
	"strings"

	"github.com/QuantumNous/new-api/types"
)

// maxPriceReferenceDepth 限制价格跟随链的最大跳数，防止环状绑定导致解析过深。
const maxPriceReferenceDepth = 3

// modelPriceReferenceMap 保存"别名模型 → 源模型"的价格跟随绑定。
// 别名模型自身未配置的价格项，解析时取链上源模型的对应值，
// 因此官方价格同步或手动修改源模型价格后，别名模型自动跟随。
var modelPriceReferenceMap = types.NewRWMap[string, string]()

func ModelPriceReference2JSONString() string {
	return modelPriceReferenceMap.MarshalJSONString()
}

func UpdateModelPriceReferenceByJSONString(jsonStr string) error {
	return types.LoadFromJsonString(modelPriceReferenceMap, jsonStr)
}

// HasPricedReference 判断模型的价格跟随链上是否存在已定价的源模型。
// hasPricing 由调用方提供（例如检查 model_price/model_ratio 是否配置了该模型），
// 用于悬空绑定的识别：绑定了但链上没有任何已定价源模型时返回 false。
func HasPricedReference(name string, hasPricing func(model string) bool) bool {
	if hasPricing == nil {
		return false
	}
	for _, source := range priceReferenceSources(name) {
		if hasPricing(source) {
			return true
		}
	}
	return false
}

// priceReferenceChain 返回从 name 出发的价格跟随链（含 name 自身，链头在前）。
// 遇到缺失绑定、空白值、自引用或环时截断，链长不超过 1 + maxPriceReferenceDepth。
func priceReferenceChain(name string) []string {
	chain := []string{name}
	visited := map[string]struct{}{name: {}}
	current := name
	for i := 0; i < maxPriceReferenceDepth; i++ {
		next, ok := modelPriceReferenceMap.Get(current)
		if !ok {
			break
		}
		next = strings.TrimSpace(next)
		if next == "" {
			break
		}
		if _, seen := visited[next]; seen {
			break
		}
		chain = append(chain, next)
		visited[next] = struct{}{}
		current = next
	}
	return chain
}

// priceReferenceSources 返回 name 需要跟随的源模型（不含 name 自身）。
func priceReferenceSources(name string) []string {
	chain := priceReferenceChain(name)
	if len(chain) <= 1 {
		return nil
	}
	return chain[1:]
}
