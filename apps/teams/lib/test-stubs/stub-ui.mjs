import { createElement } from "react";
const el = (tag) => ({ children, ...p }) => createElement(tag, Object.fromEntries(Object.entries(p).filter(([k]) => /^(aria-|data-|className|id|value|placeholder)/.test(k))), children);
export const Button = el("button");
export const InputGroup = el("div");
export const InputGroupAddon = el("div");
export const InputGroupInput = el("input");
export const useT = () => (k) => k;
export const useTrackedRouter = () => ({ push() {}, replace() {} });
