import { Flow, computeFlow } from "./flow";

export type FlowRequest = {
  key: string;
  from: Uint8ClampedArray;
  to: Uint8ClampedArray;
  width: number;
  height: number;
};

export type FlowResponse = Flow & {
  key: string;
};

self.onmessage = (event: MessageEvent<FlowRequest>) => {
  const { key, from, to, width, height } = event.data;
  const { fx, fy } = computeFlow(from, to, width, height);
  const response: FlowResponse = { key, fx, fy };
  (self as unknown as Worker).postMessage(response, [fx.buffer, fy.buffer]);
};
