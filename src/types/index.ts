export type Role='owner'|'manager'|'advisor'|'technician'|'accounting'|'warehouse';
export type PageKey='dashboard'|'customers'|'fleets'|'vehicles'|'appointments'|'workOrders'|'estimates'|'invoices'|'inventory'|'purchaseOrders'|'vendors'|'finance'|'warranties'|'approvals'|'users'|'audit'|'settings';
export interface FieldConfig{key:string;label:string;type?:'text'|'number'|'date'|'datetime-local'|'email'|'tel'|'textarea'|'select';required?:boolean;hiddenInTable?:boolean;options?:Array<{label:string;value:string}>}
export interface ModuleConfig{table:string;title:string;subtitle:string;fields:FieldConfig[]}
