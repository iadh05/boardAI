// Files the bundler (Vite) handles for us.
// The package ships its own stylesheet, imported by <Diagram>.
declare module '*.css';
// `?url` imports resolve to the hashed asset URL (used for libavoid's .wasm).
declare module '*?url' {
  const url: string;
  export default url;
}
