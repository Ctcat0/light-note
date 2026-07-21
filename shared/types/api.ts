export type ApiErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHENTICATED"
  | "USER_DISABLED"
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

export interface CloudFunctionRequest<TPayload extends object> {
  action: string;
  requestId: string;
  payload: TPayload;
}

