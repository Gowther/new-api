package model

import (
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

type ModelRuleCoverage struct {
	Total     int      `json:"total"`
	Covered   []string `json:"covered"`
	Uncovered []string `json:"uncovered"`
}

type ModelRuleCoverageSnapshot struct {
	Addable ModelRuleCoverage `json:"addable"`
	Channel ModelRuleCoverage `json:"channel"`
}

type StaleModelPricingItem struct {
	Model  string   `json:"model"`
	Fields []string `json:"fields"`
}

type StaleModelPricingReport struct {
	Total int                     `json:"total"`
	Items []StaleModelPricingItem `json:"items"`
}

type ModelPricingHealth struct {
	StalePricing StaleModelPricingReport `json:"stale_pricing"`
	UnsetPricing []string                `json:"unset_pricing"`
}

type modelPricingMap struct {
	OptionKey string
	Fields    []string
	Values    map[string]any
}

// GetMissingModels returns enabled channel models that are not covered by any
// enabled model management rule.
func GetMissingModels() ([]string, error) {
	coverage, err := CheckModelRuleCoverage(GetEnabledModels())
	if err != nil {
		return nil, err
	}
	return coverage.Uncovered, nil
}

func CheckModelRuleCoverage(modelNames []string) (ModelRuleCoverage, error) {
	modelNames = normalizeLookupValues(modelNames)
	coverage := ModelRuleCoverage{
		Total:     len(modelNames),
		Covered:   []string{},
		Uncovered: []string{},
	}
	if len(modelNames) == 0 {
		return coverage, nil
	}

	var metas []Model
	if err := DB.Where("status = ?", 1).Order("id ASC").Find(&metas).Error; err != nil {
		return coverage, err
	}

	exactMetas := make(map[string]*Model)
	prefixMetas := make([]*Model, 0)
	suffixMetas := make([]*Model, 0)
	containsMetas := make([]*Model, 0)
	for i := range metas {
		meta := &metas[i]
		metaName := strings.TrimSpace(meta.ModelName)
		if metaName == "" {
			continue
		}
		switch meta.NameRule {
		case NameRuleExact:
			exactMetas[metaName] = meta
		case NameRulePrefix:
			prefixMetas = append(prefixMetas, meta)
		case NameRuleSuffix:
			suffixMetas = append(suffixMetas, meta)
		case NameRuleContains:
			containsMetas = append(containsMetas, meta)
		}
	}

	for _, modelName := range modelNames {
		if matchModelVendorMeta(modelName, exactMetas, prefixMetas, suffixMetas, containsMetas) != nil {
			coverage.Covered = append(coverage.Covered, modelName)
		} else {
			coverage.Uncovered = append(coverage.Uncovered, modelName)
		}
	}
	return coverage, nil
}

func GetChannelModelNames() ([]string, error) {
	var rawModels []string
	if err := DB.Model(&Channel{}).Pluck("models", &rawModels).Error; err != nil {
		return nil, err
	}

	names := make([]string, 0)
	for _, raw := range rawModels {
		for _, name := range strings.Split(raw, ",") {
			name = strings.TrimSpace(name)
			if name != "" {
				names = append(names, name)
			}
		}
	}
	names = normalizeLookupValues(names)
	sort.Strings(names)
	return names, nil
}

func GetModelRuleCoverageSnapshot(addableModelNames []string) (ModelRuleCoverageSnapshot, error) {
	addable, err := CheckModelRuleCoverage(addableModelNames)
	if err != nil {
		return ModelRuleCoverageSnapshot{}, err
	}

	channelModelNames, err := GetChannelModelNames()
	if err != nil {
		return ModelRuleCoverageSnapshot{}, err
	}

	channel, err := CheckModelRuleCoverage(channelModelNames)
	if err != nil {
		return ModelRuleCoverageSnapshot{}, err
	}

	return ModelRuleCoverageSnapshot{
		Addable: addable,
		Channel: channel,
	}, nil
}

func GetModelPricingHealth() (ModelPricingHealth, error) {
	stalePricing, err := GetStaleModelPricingSettings()
	if err != nil {
		return ModelPricingHealth{}, err
	}

	unsetPricing, err := GetEnabledModelsWithoutPricingConfig()
	if err != nil {
		return ModelPricingHealth{}, err
	}

	return ModelPricingHealth{
		StalePricing: stalePricing,
		UnsetPricing: unsetPricing,
	}, nil
}

func GetEnabledModelsWithoutPricingConfig() ([]string, error) {
	modelNames := normalizeLookupValues(GetEnabledModels())
	sort.Strings(modelNames)
	if len(modelNames) == 0 {
		return []string{}, nil
	}

	modelPrice := ratio_setting.GetModelPriceCopy()
	modelRatio := ratio_setting.GetModelRatioCopy()
	billingMode := billing_setting.GetBillingModeCopy()
	billingExpr := billing_setting.GetBillingExprCopy()

	unset := make([]string, 0)
	for _, modelName := range modelNames {
		if _, ok := modelPrice[modelName]; ok {
			continue
		}
		if _, ok := modelRatio[modelName]; ok {
			continue
		}
		if billingMode[modelName] == billing_setting.BillingModeTieredExpr && strings.TrimSpace(billingExpr[modelName]) != "" {
			continue
		}
		unset = append(unset, modelName)
	}
	return unset, nil
}

func GetStaleModelPricingSettings() (StaleModelPricingReport, error) {
	channelModelNames, err := GetChannelModelNames()
	if err != nil {
		return StaleModelPricingReport{}, err
	}
	channelModelSet := make(map[string]struct{}, len(channelModelNames))
	for _, modelName := range channelModelNames {
		channelModelSet[modelName] = struct{}{}
	}

	fieldsByModel := collectPricingFieldsByModel()
	items := make([]StaleModelPricingItem, 0)
	modelNames := make([]string, 0, len(fieldsByModel))
	for modelName := range fieldsByModel {
		modelNames = append(modelNames, modelName)
	}
	sort.Strings(modelNames)

	for _, modelName := range modelNames {
		if shouldKeepPricingModelKey(modelName) {
			continue
		}
		if _, ok := channelModelSet[modelName]; ok {
			continue
		}
		fields := fieldsByModel[modelName]
		sort.Strings(fields)
		items = append(items, StaleModelPricingItem{
			Model:  modelName,
			Fields: fields,
		})
	}

	return StaleModelPricingReport{
		Total: len(items),
		Items: items,
	}, nil
}

func CleanupStaleModelPricingSettings() (StaleModelPricingReport, error) {
	report, err := GetStaleModelPricingSettings()
	if err != nil {
		return StaleModelPricingReport{}, err
	}
	if len(report.Items) == 0 {
		return report, nil
	}

	staleModels := make(map[string]struct{}, len(report.Items))
	for _, item := range report.Items {
		staleModels[item.Model] = struct{}{}
	}

	for _, pricingMap := range getModelPricingMaps() {
		if !deleteStalePricingKeys(pricingMap.Values, staleModels) {
			continue
		}
		if err := updatePricingOptionMap(pricingMap.OptionKey, pricingMap.Values); err != nil {
			return StaleModelPricingReport{}, err
		}
	}

	RefreshPricing()
	ratio_setting.InvalidateExposedDataCache()
	return report, nil
}

func deleteStalePricingKeys(values map[string]any, staleModels map[string]struct{}) bool {
	changed := false
	for modelName := range values {
		if _, ok := staleModels[strings.TrimSpace(modelName)]; !ok {
			continue
		}
		delete(values, modelName)
		changed = true
	}
	return changed
}

func collectPricingFieldsByModel() map[string][]string {
	fieldsByModel := make(map[string][]string)
	for _, pricingMap := range getModelPricingMaps() {
		for modelName := range pricingMap.Values {
			modelName = strings.TrimSpace(modelName)
			if modelName == "" {
				continue
			}
			fieldsByModel[modelName] = append(fieldsByModel[modelName], pricingMap.Fields...)
		}
	}
	return fieldsByModel
}

func getModelPricingMaps() []modelPricingMap {
	return []modelPricingMap{
		{
			OptionKey: "ModelPrice",
			Fields:    []string{"ModelPrice"},
			Values:    floatMapToAny(ratio_setting.GetModelPriceCopy()),
		},
		{
			OptionKey: "ModelRatio",
			Fields:    []string{"ModelRatio"},
			Values:    floatMapToAny(ratio_setting.GetModelRatioCopy()),
		},
		{
			OptionKey: "CompletionRatio",
			Fields:    []string{"CompletionRatio"},
			Values:    floatMapToAny(ratio_setting.GetCompletionRatioCopy()),
		},
		{
			OptionKey: "CacheRatio",
			Fields:    []string{"CacheRatio"},
			Values:    floatMapToAny(ratio_setting.GetCacheRatioCopy()),
		},
		{
			OptionKey: "CreateCacheRatio",
			Fields:    []string{"CreateCacheRatio"},
			Values:    floatMapToAny(ratio_setting.GetCreateCacheRatioCopy()),
		},
		{
			OptionKey: "ImageRatio",
			Fields:    []string{"ImageRatio"},
			Values:    floatMapToAny(ratio_setting.GetImageRatioCopy()),
		},
		{
			OptionKey: "AudioRatio",
			Fields:    []string{"AudioRatio"},
			Values:    floatMapToAny(ratio_setting.GetAudioRatioCopy()),
		},
		{
			OptionKey: "AudioCompletionRatio",
			Fields:    []string{"AudioCompletionRatio"},
			Values:    floatMapToAny(ratio_setting.GetAudioCompletionRatioCopy()),
		},
		{
			OptionKey: "billing_setting." + billing_setting.BillingModeField,
			Fields:    []string{billing_setting.BillingModeField},
			Values:    stringMapToAny(billing_setting.GetBillingModeCopy()),
		},
		{
			OptionKey: "billing_setting." + billing_setting.BillingExprField,
			Fields:    []string{billing_setting.BillingExprField},
			Values:    stringMapToAny(billing_setting.GetBillingExprCopy()),
		},
	}
}

func floatMapToAny(values map[string]float64) map[string]any {
	result := make(map[string]any, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}

func stringMapToAny(values map[string]string) map[string]any {
	result := make(map[string]any, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}

func updatePricingOptionMap(optionKey string, values map[string]any) error {
	data, err := common.Marshal(values)
	if err != nil {
		return err
	}
	return UpdateOption(optionKey, string(data))
}

func shouldKeepPricingModelKey(modelName string) bool {
	return strings.Contains(modelName, "*")
}
