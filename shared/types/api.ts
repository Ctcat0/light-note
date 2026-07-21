export type ApiErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHENTICATED"
  | "USER_NOT_INITIALIZED"
  | "USER_DISABLED"
  | "INVALID_AMOUNT"
  | "CATEGORY_REQUIRED"
  | "CATEGORY_NOT_FOUND"
  | "CATEGORY_NOT_OWNED"
  | "CATEGORY_TYPE_INVALID"
  | "CATEGORY_DISABLED"
  | "ACCOUNT_REQUIRED"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_NOT_OWNED"
  | "ACCOUNT_DISABLED"
  | "INVALID_OCCURRED_AT"
  | "INVALID_YEAR"
  | "INVALID_MONTH"
  | "INVALID_PAGE_SIZE"
  | "INVALID_CURSOR"
  | "NOTE_TOO_LONG"
  | "REQUEST_ID_REQUIRED"
  | "TRANSACTION_CREATE_FAILED"
  | "TRANSACTION_LIST_FAILED"
  | "TRANSACTION_SUMMARY_FAILED"
  | "TRANSACTION_NOT_FOUND"
  | "TRANSACTION_ID_REQUIRED"
  | "TRANSACTION_NOT_OWNED"
  | "TRANSACTION_TYPE_INVALID"
  | "TRANSACTION_ALREADY_DELETED"
  | "TRANSACTION_CONFLICT"
  | "TRANSACTION_UPDATE_FAILED"
  | "TRANSACTION_DELETE_FAILED"
  | "RESOURCE_NOT_FOUND"
  | "VERSION_CONFLICT"
  | "DUPLICATE_REQUEST"
  | "RATE_LIMITED"
  | "WEATHER_LOCATION_REQUIRED"
  | "WEATHER_UNAVAILABLE"
  | "DEPENDENCY_ERROR"
  | "INTERNAL_ERROR";

interface ApiResponseBase {
  requestId: string;
  serverTime: string;
}

export interface ApiSuccess<TData> extends ApiResponseBase {
  success: true;
  code: "OK";
  message: string;
  data: TData;
}

export interface ApiFailure extends ApiResponseBase {
  success: false;
  code: ApiErrorCode;
  message: string;
  data: null;
}

export type ApiResponse<TData> = ApiSuccess<TData> | ApiFailure;

export type CloudFunctionResponse<TData> = ApiResponse<TData>;

export interface CloudFunctionRequest<TPayload extends object> {
  action: string;
  requestId: string;
  payload: TPayload;
}
