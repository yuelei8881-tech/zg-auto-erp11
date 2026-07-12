export const money=(n:number|string|null|undefined)=>'$'+Number(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
export const today=()=>new Date().toISOString().slice(0,10);
