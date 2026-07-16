-- Preserve work-order photos while removing duplicate copies from audit snapshots.
update public.zg_erp_records
set payload = payload #- '{before,evidencePhotos}' #- '{after,evidencePhotos}'
where module = 'changeLogs'
  and (payload #> '{before,evidencePhotos}' is not null
    or payload #> '{after,evidencePhotos}' is not null);

update public.zg_erp_records
set payload = payload #- '{proposedOrder,evidencePhotos}'
where module = 'approvalRequests'
  and payload #> '{proposedOrder,evidencePhotos}' is not null;
