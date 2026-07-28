import type { AccountType, CategoryType } from "../../../../shared/types/user";

export interface CategoryTemplate {
  type: CategoryType;
  systemKey: string;
  name: string;
  icon: string;
  sortOrder: number;
}

export interface AccountTemplate {
  systemKey: string;
  name: string;
  type: AccountType;
  icon: string;
  sortOrder: number;
}

export const DEFAULT_EXPENSE_CATEGORIES = [
  { type: "expense", systemKey: "expense_food", name: "餐饮", icon: "food", sortOrder: 0 },
  { type: "expense", systemKey: "expense_transport", name: "交通", icon: "transport", sortOrder: 1 },
  { type: "expense", systemKey: "expense_shopping", name: "购物", icon: "shopping", sortOrder: 2 },
  { type: "expense", systemKey: "expense_housing", name: "居住", icon: "housing", sortOrder: 3 },
  { type: "expense", systemKey: "expense_entertainment", name: "娱乐", icon: "entertainment", sortOrder: 4 },
  { type: "expense", systemKey: "expense_medical", name: "医疗", icon: "medical", sortOrder: 5 },
  { type: "expense", systemKey: "expense_education", name: "学习", icon: "education", sortOrder: 6 },
  { type: "expense", systemKey: "expense_communication", name: "通讯", icon: "communication", sortOrder: 7 },
  { type: "expense", systemKey: "expense_social", name: "人情", icon: "social", sortOrder: 8 },
  { type: "expense", systemKey: "expense_travel", name: "旅行", icon: "travel", sortOrder: 9 },
  { type: "expense", systemKey: "expense_other", name: "其他", icon: "other", sortOrder: 10 },
] as const satisfies readonly CategoryTemplate[];

export const DEFAULT_INCOME_CATEGORIES = [
  { type: "income", systemKey: "income_salary", name: "工资", icon: "salary", sortOrder: 0 },
  { type: "income", systemKey: "income_bonus", name: "奖金", icon: "bonus", sortOrder: 1 },
  { type: "income", systemKey: "income_part_time", name: "兼职", icon: "part-time", sortOrder: 2 },
  { type: "income", systemKey: "income_reimbursement", name: "报销", icon: "reimbursement", sortOrder: 3 },
  { type: "income", systemKey: "income_investment", name: "理财收益", icon: "investment", sortOrder: 4 },
  { type: "income", systemKey: "income_red_packet", name: "红包", icon: "red-packet", sortOrder: 5 },
  { type: "income", systemKey: "income_refund", name: "退款", icon: "refund", sortOrder: 6 },
  { type: "income", systemKey: "income_other", name: "其他", icon: "other", sortOrder: 7 },
] as const satisfies readonly CategoryTemplate[];

export const DEFAULT_ACCOUNTS = [
  { systemKey: "account_wechat", name: "微信", type: "wechat", icon: "wechat", sortOrder: 0 },
  { systemKey: "account_alipay", name: "支付宝", type: "alipay", icon: "alipay", sortOrder: 1 },
  { systemKey: "account_bank", name: "银行卡", type: "bank", icon: "bank", sortOrder: 2 },
  { systemKey: "account_cash", name: "现金", type: "cash", icon: "cash", sortOrder: 3 },
  { systemKey: "account_other", name: "其他", type: "other", icon: "other", sortOrder: 4 },
] as const satisfies readonly AccountTemplate[];
