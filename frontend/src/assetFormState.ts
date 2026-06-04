type SaleRestrictionAsset = {
  valuationDate: string;
  liquidFrom: string;
};

type SaleRestrictionForm = {
  valuationDate: string;
  liquidFrom: string;
  isSaleRestricted: boolean;
};

export function isAssetSaleRestricted(asset: SaleRestrictionAsset) {
  return asset.liquidFrom > asset.valuationDate;
}

export function assetSaleRestrictionFormState(assets: SaleRestrictionAsset[]) {
  const restrictedAssets = assets.filter(isAssetSaleRestricted);
  const sourceAssets = restrictedAssets.length > 0 ? restrictedAssets : assets;
  const liquidFrom = sourceAssets.reduce((latestDate, asset) => (asset.liquidFrom > latestDate ? asset.liquidFrom : latestDate), sourceAssets[0]?.liquidFrom ?? "");

  return {
    isSaleRestricted: restrictedAssets.length > 0,
    liquidFrom
  };
}

export function liquidFromForSaleRestrictionForm(form: SaleRestrictionForm) {
  return form.isSaleRestricted ? form.liquidFrom : form.valuationDate;
}

export function liquidFromForSaleRestrictionLot(asset: SaleRestrictionAsset, form: SaleRestrictionForm) {
  return form.isSaleRestricted ? form.liquidFrom : asset.valuationDate;
}

export function hasSaleRestrictionFormChanged(assets: SaleRestrictionAsset[], form: SaleRestrictionForm) {
  const current = assetSaleRestrictionFormState(assets);
  return current.isSaleRestricted !== form.isSaleRestricted || (form.isSaleRestricted && current.liquidFrom !== form.liquidFrom);
}
