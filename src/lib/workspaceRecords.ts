import type { CloudStore } from './cloud';
// Mirror the server read model when persisting a locally opened full record.
export function compactWorkspaceStore(store: CloudStore): CloudStore {
  return Object.fromEntries(Object.entries(store).map(([module, rows]) => [module, rows.map(row => {
    if (module === 'changeLogs') { const { before, after, ...rest } = row; return { ...rest, _detailsDeferred: true }; }
    if (module !== 'workOrders') return row;
    const { customerSignature, evidencePhotos, ...rest } = row;
    return { ...rest, _detailsDeferred: true, evidencePhotos: (Array.isArray(evidencePhotos) ? evidencePhotos : []).map(photo => {
      if (!photo || typeof photo !== 'object' || Array.isArray(photo)) return photo;
      const { dataUrl, ...metadata } = photo; return metadata;
    }) };
  })]));
}
