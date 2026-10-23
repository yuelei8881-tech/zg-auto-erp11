-- Preserve recursive field-level authorization exactly, but avoid one function
-- call and a growing JSONB concatenation for every scalar field.
create or replace function zg_private.redact(p jsonb, prices boolean, finances boolean, contacts boolean)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb; denied text[] := '{}'::text[];
begin
 if p is null then return '{}'::jsonb; end if;
 if jsonb_typeof(p)='array' then
   select coalesce(jsonb_agg(case when jsonb_typeof(value) in ('array','object')
     then zg_private.redact(value,prices,finances,contacts) else value end order by ord),'[]'::jsonb)
   into result from jsonb_array_elements(p) with ordinality as elements(value,ord);
   return result;
 elsif jsonb_typeof(p)<>'object' then return p; end if;
 if not prices then denied := denied || array['price','rate','flatAmount','total','tax','taxRate','taxOverride','discount','settlementTotal','laborTotal','partsTotal','outsource','defaultLaborRate','defaultTaxRate','markupPercent','amount','oldValue','newValue','creditLimit','notes','note','before','after','proposedOrder','proposedExpense','proposedPayment','documentSendHistory','customerApprovalUrl']; end if;
 if not finances then denied := denied || array['cost','costTotal','partsCost','grossProfit','unitCost','totalCost','paid','balance','paymentMethod','reconciliationSnapshot']; end if;
 if not contacts then denied := denied || array['phone','secondaryPhone','driverPhone','email','billingEmail','address','licenseLast4','customerSignature','notes','note','documentSendHistory','customerApprovalUrl']; end if;
 select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value) in ('array','object')
   then zg_private.redact(value,prices,finances,contacts) else value end),'{}'::jsonb)
 into result from jsonb_each(p - denied);
 return result;
end $$;
-- CREATE OR REPLACE preserves the existing private function's ACL and callers.
