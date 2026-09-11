package billingexpr

import "github.com/QuantumNous/new-api/common"

// quotaConversion converts raw expression output to quota based on the
// expression version. This is the central dispatch point for future versions
// that may use a different conversion formula.
func quotaConversion(exprOutput float64, snap *BillingSnapshot) float64 {
	switch snap.ExprVersion {
	default: // v1: coefficients are $/1M tokens prices
		return exprOutput / 1_000_000 * snap.QuotaPerUnit
	}
}

// ComputeTieredQuota runs the Expr from a frozen BillingSnapshot against
// actual token counts and returns the settlement result.
func ComputeTieredQuota(snap *BillingSnapshot, params TokenParams) (TieredResult, error) {
	return ComputeTieredQuotaWithRequest(snap, params, RequestInput{})
}

func ComputeTieredQuotaWithRequest(snap *BillingSnapshot, params TokenParams, request RequestInput) (TieredResult, error) {
	cost, trace, err := RunExprByHashWithRequest(snap.ExprString, snap.ExprHash, params, request)
	if err != nil {
		return TieredResult{}, err
	}

	quotaBeforeGroup := quotaConversion(cost, snap)
	// Billing invariant: an expression that evaluates negative at settle time
	// must never become a user credit (a negative settle delta would refund
	// more than was pre-consumed). Floor the charge at zero and record the
	// clamp so it is audited like any other quota saturation event.
	var clamp *common.QuotaClamp
	if quotaBeforeGroup < 0 {
		clamp = &common.QuotaClamp{Op: "TieredSettle", Kind: common.QuotaClampNegative, Original: quotaBeforeGroup, Clamped: 0}
		common.SysError(clamp.Error())
		quotaBeforeGroup = 0
	}

	afterGroup, roundClamp := common.QuotaRoundChecked(quotaBeforeGroup * snap.GroupRatio)
	if clamp == nil {
		clamp = roundClamp
	}
	if afterGroup < 0 {
		// A negative group ratio (misconfiguration) must not produce a credit either.
		if clamp == nil {
			clamp = &common.QuotaClamp{Op: "TieredSettle", Kind: common.QuotaClampNegative, Original: float64(afterGroup), Clamped: 0}
			common.SysError(clamp.Error())
		}
		afterGroup = 0
	}
	crossed := trace.MatchedTier != snap.EstimatedTier

	return TieredResult{
		ActualQuotaBeforeGroup: quotaBeforeGroup,
		ActualQuotaAfterGroup:  afterGroup,
		MatchedTier:            trace.MatchedTier,
		CrossedTier:            crossed,
		Clamp:                  clamp,
	}, nil
}
