// libavoid-js's own typings point at a file it doesn't ship and don't match the real bindings
// (constants live under embind enums). This declares only the part we use — see avoid.ts.
declare module 'libavoid-js' {
  export const AvoidLib: {
    load(wasmPath?: string): Promise<void>;
    getInstance(): unknown;
  };
}
