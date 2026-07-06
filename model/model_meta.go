package model

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

const (
	NameRuleExact = iota
	NameRulePrefix
	NameRuleContains
	NameRuleSuffix
)

type BoundChannel struct {
	Name        string                       `json:"name"`
	Type        int                          `json:"type"`
	Groups      []string                     `json:"-"`
	groupOrders map[string]boundChannelOrder `json:"-" gorm:"-"`
}

type boundChannelOrder struct {
	Priority int64
	Weight   uint
}

func (c *BoundChannel) addGroupOrder(group string, priority int64, weight uint) {
	if c.groupOrders == nil {
		c.groupOrders = make(map[string]boundChannelOrder)
	}

	groupKey := group
	if groupKey == "" {
		groupKey = "all"
	}

	current, exists := c.groupOrders[groupKey]
	if !exists || priority > current.Priority || (priority == current.Priority && weight > current.Weight) {
		c.groupOrders[groupKey] = boundChannelOrder{
			Priority: priority,
			Weight:   weight,
		}
	}
}

func (c BoundChannel) BestPriorityWeightForGroups(usableGroup map[string]string) (int64, uint) {
	var (
		bestPriority int64
		bestWeight   uint
		found        bool
	)

	for group, order := range c.groupOrders {
		if group != "all" {
			if _, ok := usableGroup[group]; !ok {
				continue
			}
		}
		if !found || order.Priority > bestPriority || (order.Priority == bestPriority && order.Weight > bestWeight) {
			bestPriority = order.Priority
			bestWeight = order.Weight
			found = true
		}
	}

	if !found {
		return 0, 0
	}
	return bestPriority, bestWeight
}

type Model struct {
	Id           int            `json:"id"`
	ModelName    string         `json:"model_name" gorm:"size:128;not null;uniqueIndex:uk_model_name_delete_at,priority:1"`
	Description  string         `json:"description,omitempty" gorm:"type:text"`
	Icon         string         `json:"icon,omitempty" gorm:"type:varchar(128)"`
	Tags         string         `json:"tags,omitempty" gorm:"type:varchar(255)"`
	VendorID     int            `json:"vendor_id,omitempty" gorm:"index"`
	Endpoints    string         `json:"endpoints,omitempty" gorm:"type:text"`
	Status       int            `json:"status" gorm:"default:1"`
	SyncOfficial int            `json:"sync_official" gorm:"default:1"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime  int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index;uniqueIndex:uk_model_name_delete_at,priority:2"`

	BoundChannels []BoundChannel `json:"bound_channels,omitempty" gorm:"-"`
	EnableGroups  []string       `json:"enable_groups,omitempty" gorm:"-"`
	QuotaTypes    []int          `json:"quota_types,omitempty" gorm:"-"`
	NameRule      int            `json:"name_rule" gorm:"default:0"`

	MatchedModels []string `json:"matched_models,omitempty" gorm:"-"`
	MatchedCount  int      `json:"matched_count,omitempty" gorm:"-"`
}

type ModelVendorGroup struct {
	VendorID   int      `json:"vendor_id"`
	VendorName string   `json:"vendor_name"`
	Models     []string `json:"models"`
}

func (mi *Model) Insert() error {
	now := common.GetTimestamp()
	mi.CreatedTime = now
	mi.UpdatedTime = now

	// 保存原始值（因为 Create 后可能被 GORM 的 default 标签覆盖为 1）
	originalStatus := mi.Status
	originalSyncOfficial := mi.SyncOfficial

	// 先创建记录（GORM 会对零值字段应用默认值）
	if err := DB.Create(mi).Error; err != nil {
		return err
	}

	// 使用保存的原始值进行更新，确保零值能正确保存
	return DB.Model(&Model{}).Where("id = ?", mi.Id).Updates(map[string]interface{}{
		"status":        originalStatus,
		"sync_official": originalSyncOfficial,
	}).Error
}

func IsModelNameDuplicated(id int, name string) (bool, error) {
	if name == "" {
		return false, nil
	}
	var cnt int64
	err := DB.Model(&Model{}).Where("model_name = ? AND id <> ?", name, id).Count(&cnt).Error
	return cnt > 0, err
}

func (mi *Model) Update() error {
	mi.UpdatedTime = common.GetTimestamp()
	// 使用 Select 强制更新所有字段，包括零值
	return DB.Model(&Model{}).Where("id = ?", mi.Id).
		Select("model_name", "description", "icon", "tags", "vendor_id", "endpoints", "status", "sync_official", "name_rule", "updated_time").
		Updates(mi).Error
}

func (mi *Model) Delete() error {
	return DB.Delete(mi).Error
}

func GetVendorModelCounts() (map[int64]int64, error) {
	var stats []struct {
		VendorID int64
		Count    int64
	}
	if err := DB.Model(&Model{}).
		Select("vendor_id as vendor_id, count(*) as count").
		Group("vendor_id").
		Scan(&stats).Error; err != nil {
		return nil, err
	}
	m := make(map[int64]int64, len(stats))
	for _, s := range stats {
		m[s.VendorID] = s.Count
	}
	return m, nil
}

func GroupModelNamesByVendor(modelNames []string) ([]ModelVendorGroup, error) {
	modelNames = normalizeLookupValues(modelNames)
	if len(modelNames) == 0 {
		return []ModelVendorGroup{}, nil
	}

	var metas []Model
	if err := DB.Order("id ASC").Find(&metas).Error; err != nil {
		return nil, err
	}

	var vendors []Vendor
	if err := DB.Find(&vendors).Error; err != nil {
		return nil, err
	}
	vendorNames := make(map[int]string, len(vendors))
	for i := range vendors {
		vendorNames[vendors[i].Id] = vendors[i].Name
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

	groupsByVendor := make(map[int]*ModelVendorGroup)
	vendorOrder := make([]int, 0)
	for _, modelName := range modelNames {
		meta := matchModelVendorMeta(modelName, exactMetas, prefixMetas, suffixMetas, containsMetas)
		vendorID := 0
		vendorName := "未匹配供应商"
		if meta != nil && meta.VendorID > 0 {
			vendorID = meta.VendorID
			if name := strings.TrimSpace(vendorNames[vendorID]); name != "" {
				vendorName = name
			} else {
				vendorName = "供应商 " + strconv.Itoa(vendorID)
			}
		}

		group, ok := groupsByVendor[vendorID]
		if !ok {
			group = &ModelVendorGroup{
				VendorID:   vendorID,
				VendorName: vendorName,
				Models:     make([]string, 0),
			}
			groupsByVendor[vendorID] = group
			vendorOrder = append(vendorOrder, vendorID)
		}
		group.Models = append(group.Models, modelName)
	}

	groups := make([]ModelVendorGroup, 0, len(vendorOrder))
	for _, vendorID := range vendorOrder {
		groups = append(groups, *groupsByVendor[vendorID])
	}
	return groups, nil
}

func matchModelVendorMeta(modelName string, exactMetas map[string]*Model, prefixMetas []*Model, suffixMetas []*Model, containsMetas []*Model) *Model {
	if meta, ok := exactMetas[modelName]; ok {
		return meta
	}
	for _, meta := range prefixMetas {
		if ruleName := strings.TrimSpace(meta.ModelName); ruleName != "" && strings.HasPrefix(modelName, ruleName) {
			return meta
		}
	}
	for _, meta := range suffixMetas {
		if ruleName := strings.TrimSpace(meta.ModelName); ruleName != "" && strings.HasSuffix(modelName, ruleName) {
			return meta
		}
	}
	for _, meta := range containsMetas {
		if ruleName := strings.TrimSpace(meta.ModelName); ruleName != "" && strings.Contains(modelName, ruleName) {
			return meta
		}
	}
	return nil
}

func GetAllModels(offset int, limit int) ([]*Model, error) {
	var models []*Model
	err := DB.Order("id DESC").Offset(offset).Limit(limit).Find(&models).Error
	return models, err
}

func GetBoundChannelsByModelsMap(modelNames []string) (map[string][]BoundChannel, error) {
	result := make(map[string][]BoundChannel)
	if len(modelNames) == 0 {
		return result, nil
	}
	type row struct {
		Model        string
		Name         string
		Type         int
		AbilityGroup string
		Priority     int64
		Weight       uint
	}
	var rows []row
	err := DB.Table("channels").
		Select("abilities.model as model, channels.name as name, channels.type as type, abilities."+commonGroupCol+" as ability_group, abilities.priority as priority, abilities.weight as weight").
		Joins("JOIN abilities ON abilities.channel_id = channels.id").
		Where("abilities.model IN ? AND abilities.enabled = ?", modelNames, true).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	modelChannelIndex := make(map[string]map[string]int, len(modelNames))
	for _, r := range rows {
		channelKey := r.Name + "_" + strconv.Itoa(r.Type)
		indexByChannel, ok := modelChannelIndex[r.Model]
		if !ok {
			indexByChannel = make(map[string]int)
			modelChannelIndex[r.Model] = indexByChannel
		}
		if idx, exists := indexByChannel[channelKey]; exists {
			result[r.Model][idx].addGroupOrder(r.AbilityGroup, r.Priority, r.Weight)
			if r.AbilityGroup != "" && !common.StringsContains(result[r.Model][idx].Groups, r.AbilityGroup) {
				result[r.Model][idx].Groups = append(result[r.Model][idx].Groups, r.AbilityGroup)
			}
			continue
		}

		channel := BoundChannel{
			Name: r.Name,
			Type: r.Type,
		}
		channel.addGroupOrder(r.AbilityGroup, r.Priority, r.Weight)
		if r.AbilityGroup != "" {
			channel.Groups = []string{r.AbilityGroup}
		}
		result[r.Model] = append(result[r.Model], channel)
		indexByChannel[channelKey] = len(result[r.Model]) - 1
	}
	return result, nil
}

func normalizeLookupValues(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized
}

func GetPreferredModelOwnerChannelTypes(modelNames []string, groups []string) (map[string]int, error) {
	result := make(map[string]int)
	modelNames = normalizeLookupValues(modelNames)
	if len(modelNames) == 0 {
		return result, nil
	}

	type row struct {
		Model       string
		ChannelType int
	}
	var rows []row

	query := DB.Table("abilities").
		Select("abilities.model as model, channels.type as channel_type").
		Joins("JOIN channels ON abilities.channel_id = channels.id").
		Where("abilities.model IN ? AND abilities.enabled = ? AND channels.status = ?", modelNames, true, common.ChannelStatusEnabled).
		Order("COALESCE(abilities.priority, 0) DESC").
		Order("abilities.weight DESC").
		Order("abilities.channel_id ASC")

	groups = normalizeLookupValues(groups)
	if len(groups) > 0 {
		query = query.Where("abilities."+commonGroupCol+" IN ?", groups)
	}

	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}

	for _, r := range rows {
		if _, ok := result[r.Model]; ok {
			continue
		}
		result[r.Model] = r.ChannelType
	}
	return result, nil
}

func SearchModels(keyword string, vendor string, offset int, limit int) ([]*Model, int64, error) {
	var models []*Model
	db := DB.Model(&Model{})
	if keyword != "" {
		like := "%" + keyword + "%"
		db = db.Where("model_name LIKE ? OR description LIKE ? OR tags LIKE ?", like, like, like)
	}
	if vendor != "" {
		if vid, err := strconv.Atoi(vendor); err == nil {
			db = db.Where("models.vendor_id = ?", vid)
		} else {
			db = db.Joins("JOIN vendors ON vendors.id = models.vendor_id").Where("vendors.name LIKE ?", "%"+vendor+"%")
		}
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := db.Order("models.id DESC").Offset(offset).Limit(limit).Find(&models).Error; err != nil {
		return nil, 0, err
	}
	return models, total, nil
}
