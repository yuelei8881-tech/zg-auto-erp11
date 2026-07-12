import type { ModuleConfig } from '../types';
export const modules:Record<string,ModuleConfig>={
  "customers": {
    "table": "customers",
    "title": "客户管理",
    "subtitle": "个人、公司与车队客户",
    "fields": [
      {
        "key": "display_name",
        "label": "客户名称",
        "type": "text",
        "required": true
      },
      {
        "key": "customer_type",
        "label": "类型",
        "type": "select",
        "options": [
          {
            "label": "个人",
            "value": "individual"
          },
          {
            "label": "公司",
            "value": "company"
          },
          {
            "label": "车队",
            "value": "fleet"
          }
        ]
      },
      {
        "key": "phone",
        "label": "电话",
        "type": "tel"
      },
      {
        "key": "email",
        "label": "Email",
        "type": "email"
      },
      {
        "key": "address",
        "label": "地址",
        "type": "text"
      },
      {
        "key": "credit_limit",
        "label": "信用额度",
        "type": "number"
      },
      {
        "key": "balance",
        "label": "欠款",
        "type": "number"
      },
      {
        "key": "notes",
        "label": "备注",
        "type": "textarea",
        "hiddenInTable": true
      }
    ]
  },
  "fleets": {
    "table": "fleets",
    "title": "车队管理",
    "subtitle": "公司、联系人、账期、信用额度",
    "fields": [
      {
        "key": "name",
        "label": "车队名称",
        "type": "text",
        "required": true
      },
      {
        "key": "contact_name",
        "label": "联系人",
        "type": "text"
      },
      {
        "key": "phone",
        "label": "电话",
        "type": "tel"
      },
      {
        "key": "email",
        "label": "Email",
        "type": "email"
      },
      {
        "key": "billing_cycle",
        "label": "账期",
        "type": "text"
      },
      {
        "key": "credit_limit",
        "label": "信用额度",
        "type": "number"
      },
      {
        "key": "balance",
        "label": "欠款",
        "type": "number"
      }
    ]
  },
  "vehicles": {
    "table": "vehicles",
    "title": "车辆管理",
    "subtitle": "VIN、车牌、Unit Number、里程",
    "fields": [
      {
        "key": "owner_name",
        "label": "客户/车队",
        "type": "text"
      },
      {
        "key": "year",
        "label": "年份",
        "type": "number"
      },
      {
        "key": "make",
        "label": "品牌",
        "type": "text"
      },
      {
        "key": "model",
        "label": "车型",
        "type": "text"
      },
      {
        "key": "vin",
        "label": "VIN",
        "type": "text"
      },
      {
        "key": "license_plate",
        "label": "车牌",
        "type": "text"
      },
      {
        "key": "unit_number",
        "label": "Unit Number",
        "type": "text"
      },
      {
        "key": "mileage",
        "label": "里程",
        "type": "number"
      },
      {
        "key": "engine",
        "label": "发动机",
        "type": "text"
      },
      {
        "key": "transmission",
        "label": "变速箱",
        "type": "text"
      }
    ]
  },
  "appointments": {
    "table": "appointments",
    "title": "预约管理",
    "subtitle": "预约日期、时间、客户、车辆",
    "fields": [
      {
        "key": "appointment_date",
        "label": "日期",
        "type": "date",
        "required": true
      },
      {
        "key": "appointment_time",
        "label": "时间",
        "type": "text"
      },
      {
        "key": "customer_name",
        "label": "客户",
        "type": "text"
      },
      {
        "key": "vehicle_desc",
        "label": "车辆",
        "type": "text"
      },
      {
        "key": "service_type",
        "label": "维修项目",
        "type": "text"
      },
      {
        "key": "status",
        "label": "状态",
        "type": "select",
        "options": [
          {
            "label": "已预约",
            "value": "scheduled"
          },
          {
            "label": "已到店",
            "value": "arrived"
          },
          {
            "label": "已完成",
            "value": "completed"
          },
          {
            "label": "取消",
            "value": "cancelled"
          }
        ]
      },
      {
        "key": "notes",
        "label": "备注",
        "type": "textarea",
        "hiddenInTable": true
      }
    ]
  },
  "workOrders": {
    "table": "work_orders",
    "title": "工单管理",
    "subtitle": "接车、检测、维修、完工、收款",
    "fields": [
      {
        "key": "order_number",
        "label": "工单号",
        "type": "text",
        "required": true
      },
      {
        "key": "customer_name",
        "label": "客户",
        "type": "text"
      },
      {
        "key": "vehicle_desc",
        "label": "车辆",
        "type": "text"
      },
      {
        "key": "status",
        "label": "状态",
        "type": "select",
        "options": [
          {
            "label": "草稿",
            "value": "draft"
          },
          {
            "label": "待审批",
            "value": "pending"
          },
          {
            "label": "维修中",
            "value": "in_progress"
          },
          {
            "label": "待质检",
            "value": "quality_check"
          },
          {
            "label": "已完成",
            "value": "completed"
          },
          {
            "label": "已付款",
            "value": "paid"
          }
        ]
      },
      {
        "key": "technician",
        "label": "技师",
        "type": "text"
      },
      {
        "key": "labor_total",
        "label": "工时",
        "type": "number"
      },
      {
        "key": "parts_total",
        "label": "配件",
        "type": "number"
      },
      {
        "key": "tax",
        "label": "税",
        "type": "number"
      },
      {
        "key": "total",
        "label": "总金额",
        "type": "number"
      },
      {
        "key": "complaint",
        "label": "客户描述",
        "type": "textarea",
        "hiddenInTable": true
      },
      {
        "key": "diagnosis",
        "label": "诊断",
        "type": "textarea",
        "hiddenInTable": true
      }
    ]
  },
  "estimates": {
    "table": "estimates",
    "title": "报价单",
    "subtitle": "维修报价与客户批准状态",
    "fields": [
      {
        "key": "estimate_number",
        "label": "报价单号",
        "type": "text",
        "required": true
      },
      {
        "key": "customer_name",
        "label": "客户",
        "type": "text"
      },
      {
        "key": "vehicle_desc",
        "label": "车辆",
        "type": "text"
      },
      {
        "key": "status",
        "label": "状态",
        "type": "select",
        "options": [
          {
            "label": "草稿",
            "value": "draft"
          },
          {
            "label": "已发送",
            "value": "sent"
          },
          {
            "label": "已批准",
            "value": "approved"
          },
          {
            "label": "拒绝",
            "value": "rejected"
          }
        ]
      },
      {
        "key": "subtotal",
        "label": "小计",
        "type": "number"
      },
      {
        "key": "tax",
        "label": "税",
        "type": "number"
      },
      {
        "key": "total",
        "label": "总金额",
        "type": "number"
      },
      {
        "key": "notes",
        "label": "备注",
        "type": "textarea",
        "hiddenInTable": true
      }
    ]
  },
  "invoices": {
    "table": "invoices",
    "title": "发票管理",
    "subtitle": "发票、付款、未收款",
    "fields": [
      {
        "key": "invoice_number",
        "label": "发票号",
        "type": "text",
        "required": true
      },
      {
        "key": "customer_name",
        "label": "客户",
        "type": "text"
      },
      {
        "key": "invoice_date",
        "label": "日期",
        "type": "date",
        "required": true
      },
      {
        "key": "due_date",
        "label": "到期日",
        "type": "date"
      },
      {
        "key": "status",
        "label": "状态",
        "type": "select",
        "options": [
          {
            "label": "未付款",
            "value": "unpaid"
          },
          {
            "label": "部分付款",
            "value": "partial"
          },
          {
            "label": "已付款",
            "value": "paid"
          },
          {
            "label": "作废",
            "value": "void"
          }
        ]
      },
      {
        "key": "total",
        "label": "总金额",
        "type": "number"
      },
      {
        "key": "paid_amount",
        "label": "已付款",
        "type": "number"
      },
      {
        "key": "balance",
        "label": "未收款",
        "type": "number"
      }
    ]
  },
  "inventory": {
    "table": "inventory_parts",
    "title": "库存管理",
    "subtitle": "配件、数量、成本、售价、预警",
    "fields": [
      {
        "key": "part_number",
        "label": "配件号",
        "type": "text"
      },
      {
        "key": "name",
        "label": "配件名称",
        "type": "text",
        "required": true
      },
      {
        "key": "quantity",
        "label": "数量",
        "type": "number"
      },
      {
        "key": "min_quantity",
        "label": "最低库存",
        "type": "number"
      },
      {
        "key": "cost",
        "label": "成本",
        "type": "number"
      },
      {
        "key": "price",
        "label": "售价",
        "type": "number"
      },
      {
        "key": "location",
        "label": "库位",
        "type": "text"
      },
      {
        "key": "supplier",
        "label": "供应商",
        "type": "text"
      }
    ]
  },
  "purchaseOrders": {
    "table": "purchase_orders",
    "title": "采购单",
    "subtitle": "采购审批、供应商、到货状态",
    "fields": [
      {
        "key": "po_number",
        "label": "采购单号",
        "type": "text",
        "required": true
      },
      {
        "key": "vendor_name",
        "label": "供应商",
        "type": "text"
      },
      {
        "key": "order_date",
        "label": "日期",
        "type": "date",
        "required": true
      },
      {
        "key": "status",
        "label": "状态",
        "type": "select",
        "options": [
          {
            "label": "草稿",
            "value": "draft"
          },
          {
            "label": "待审批",
            "value": "pending"
          },
          {
            "label": "已订购",
            "value": "ordered"
          },
          {
            "label": "已到货",
            "value": "received"
          },
          {
            "label": "取消",
            "value": "cancelled"
          }
        ]
      },
      {
        "key": "total",
        "label": "总金额",
        "type": "number"
      },
      {
        "key": "notes",
        "label": "备注",
        "type": "textarea",
        "hiddenInTable": true
      }
    ]
  },
  "vendors": {
    "table": "vendors",
    "title": "供应商管理",
    "subtitle": "供应商联系人与付款条件",
    "fields": [
      {
        "key": "name",
        "label": "供应商名称",
        "type": "text",
        "required": true
      },
      {
        "key": "contact_name",
        "label": "联系人",
        "type": "text"
      },
      {
        "key": "phone",
        "label": "电话",
        "type": "tel"
      },
      {
        "key": "email",
        "label": "Email",
        "type": "email"
      },
      {
        "key": "payment_terms",
        "label": "付款条件",
        "type": "text"
      },
      {
        "key": "balance",
        "label": "应付款",
        "type": "number"
      }
    ]
  },
  "finance": {
    "table": "finance_entries",
    "title": "财务管理",
    "subtitle": "收入、支出、付款方式、分类",
    "fields": [
      {
        "key": "entry_date",
        "label": "日期",
        "type": "date",
        "required": true
      },
      {
        "key": "entry_type",
        "label": "类型",
        "type": "select",
        "required": true,
        "options": [
          {
            "label": "收入",
            "value": "income"
          },
          {
            "label": "支出",
            "value": "expense"
          }
        ]
      },
      {
        "key": "category",
        "label": "分类",
        "type": "text"
      },
      {
        "key": "amount",
        "label": "金额",
        "type": "number",
        "required": true
      },
      {
        "key": "payment_method",
        "label": "付款方式",
        "type": "text"
      },
      {
        "key": "reference",
        "label": "关联单号",
        "type": "text"
      },
      {
        "key": "memo",
        "label": "备注",
        "type": "textarea",
        "hiddenInTable": true
      }
    ]
  },
  "warranties": {
    "table": "warranties",
    "title": "保修管理",
    "subtitle": "保修项目、日期、里程与状态",
    "fields": [
      {
        "key": "vehicle_desc",
        "label": "车辆",
        "type": "text"
      },
      {
        "key": "warranty_item",
        "label": "保修项目",
        "type": "text",
        "required": true
      },
      {
        "key": "start_date",
        "label": "开始日期",
        "type": "date"
      },
      {
        "key": "end_date",
        "label": "到期日期",
        "type": "date"
      },
      {
        "key": "mileage_limit",
        "label": "里程限制",
        "type": "number"
      },
      {
        "key": "status",
        "label": "状态",
        "type": "select",
        "options": [
          {
            "label": "有效",
            "value": "active"
          },
          {
            "label": "已到期",
            "value": "expired"
          },
          {
            "label": "已使用",
            "value": "used"
          }
        ]
      },
      {
        "key": "notes",
        "label": "备注",
        "type": "textarea",
        "hiddenInTable": true
      }
    ]
  },
  "approvals": {
    "table": "approval_requests",
    "title": "多人审批",
    "subtitle": "折扣、退款、采购、敏感修改",
    "fields": [
      {
        "key": "request_type",
        "label": "类型",
        "type": "text"
      },
      {
        "key": "title",
        "label": "标题",
        "type": "text",
        "required": true
      },
      {
        "key": "amount",
        "label": "金额",
        "type": "number"
      },
      {
        "key": "required_approvals",
        "label": "需要人数",
        "type": "number"
      },
      {
        "key": "approved_count",
        "label": "已批准人数",
        "type": "number"
      },
      {
        "key": "status",
        "label": "状态",
        "type": "select",
        "options": [
          {
            "label": "待审批",
            "value": "pending"
          },
          {
            "label": "通过",
            "value": "approved"
          },
          {
            "label": "拒绝",
            "value": "rejected"
          }
        ]
      },
      {
        "key": "notes",
        "label": "备注",
        "type": "textarea",
        "hiddenInTable": true
      }
    ]
  },
  "users": {
    "table": "staff_accounts",
    "title": "下属账号",
    "subtitle": "员工、角色、状态、权限配置",
    "fields": [
      {
        "key": "display_name",
        "label": "姓名",
        "type": "text",
        "required": true
      },
      {
        "key": "email",
        "label": "邮箱",
        "type": "email",
        "required": true
      },
      {
        "key": "role",
        "label": "角色",
        "type": "select",
        "required": true,
        "options": [
          {
            "label": "老板",
            "value": "owner"
          },
          {
            "label": "经理",
            "value": "manager"
          },
          {
            "label": "前台",
            "value": "advisor"
          },
          {
            "label": "技师",
            "value": "technician"
          },
          {
            "label": "财务",
            "value": "accounting"
          },
          {
            "label": "仓库",
            "value": "warehouse"
          }
        ]
      },
      {
        "key": "active",
        "label": "状态",
        "type": "select",
        "required": true,
        "options": [
          {
            "label": "启用",
            "value": "true"
          },
          {
            "label": "停用",
            "value": "false"
          }
        ]
      },
      {
        "key": "phone",
        "label": "电话",
        "type": "tel"
      }
    ]
  },
  "audit": {
    "table": "audit_logs",
    "title": "操作日志",
    "subtitle": "记录新增、修改、删除与审批",
    "fields": [
      {
        "key": "action",
        "label": "操作",
        "type": "text"
      },
      {
        "key": "entity_type",
        "label": "对象类型",
        "type": "text"
      },
      {
        "key": "entity_label",
        "label": "对象",
        "type": "text"
      },
      {
        "key": "actor_email",
        "label": "操作人",
        "type": "text"
      },
      {
        "key": "created_at",
        "label": "时间",
        "type": "text"
      }
    ]
  }
} as Record<string,ModuleConfig>;
