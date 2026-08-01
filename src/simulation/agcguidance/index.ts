// SPDX-License-Identifier: GPL-3.0-or-later
// M4.5a — Public surface of the reconstructed AGC-guidance layer.
//
// SAFETY: nothing in this folder can move the vehicle on its own. The only
// path to a control input is `resolveGuidanceAuthority`, which refuses in
// every mode except an explicitly engaged one with an authentic record.

export * from "./assumptions";
export * from "./pdiCheckpoint";
export * from "./targets";
export * from "./controlAdapter";
export * from "./shadowMode";
