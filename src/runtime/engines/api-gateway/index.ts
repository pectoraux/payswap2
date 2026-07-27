// API Gateway — single ingress for runtime operations. (M-RT-15.)
export type {
  GatewayRequest,
  GatewayOperation,
  GatewayResponse,
  DispatchHandler,
} from './gateway';
export { RateLimiter, IdempotencyCache, validateRequest, APIGateway } from './gateway';
