export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  statusCode: number;
  timestamp: string;
  path: string;
}
