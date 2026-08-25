/**
 * DD-023 §4 D1 (Phase A) — render-capability classifier tests. Pins classification to real
 * `UNMASKED_RENDERER_WEBGL` strings and the fail-safe rules (unknown → conservative, blind extension →
 * unknown, GPU-fell-to-SwiftShader → software).
 */
import { describe, it, expect } from 'vitest';
import {
  classifyRenderer,
  detectRenderCapability,
  resolveCapability,
  type RendererInfoContext
} from '../capability.js';

describe('classifyRenderer (DD-023 §4 D1)', () => {
  it('classifies real SOFTWARE renderer strings conservatively', () => {
    const software = [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)',
      'ANGLE (Google, Vulkan 1.1.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
      'llvmpipe (LLVM 15.0.6, 256 bits)',
      'Microsoft Basic Render Driver',
      'ANGLE (Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)'
    ];
    for (const s of software) expect(classifyRenderer(s), s).toBe('software');
  });

  it('classifies real HARDWARE renderer strings as hardware', () => {
    const hardware = [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)',
      'ANGLE (AMD, AMD Radeon RX 6800 XT (radeonsi, navi21, LLVM 15.0.6), OpenGL 4.6)',
      'Apple M1 Pro',
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
      'Adreno (TM) 640',
      'Mali-G78 MP14',
      'ANGLE (NVIDIA Corporation, GeForce GTX 1060/PCIe/SSE2, OpenGL 4.5.0)'
    ];
    for (const s of hardware) expect(classifyRenderer(s), s).toBe('hardware');
  });

  it('software markers win over a vendor name in the same string (GPU-fell-to-SwiftShader)', () => {
    // A GPU present but ANGLE fell back to SwiftShader still reads SwiftShader → software (safe direction).
    expect(classifyRenderer('ANGLE (NVIDIA, Vulkan 1.3 (SwiftShader Device (LLVM 10)), SwiftShader driver)')).toBe(
      'software'
    );
  });

  it('returns unknown for empty / null / unrecognized strings (caller opts conservative)', () => {
    expect(classifyRenderer('')).toBe('unknown');
    expect(classifyRenderer('   ')).toBe('unknown');
    expect(classifyRenderer(null)).toBe('unknown');
    expect(classifyRenderer(undefined)).toBe('unknown');
    expect(classifyRenderer('WebGL')).toBe('unknown'); // masked generic string
    expect(classifyRenderer('Some Future GPU 9000')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(classifyRenderer('swiftshader driver')).toBe('software');
    expect(classifyRenderer('nvidia geforce')).toBe('hardware');
  });
});

describe('detectRenderCapability (DD-023 §4 D1)', () => {
  const EXT = { UNMASKED_RENDERER_WEBGL: 0x9246 };

  it('reads the unmasked renderer via WEBGL_debug_renderer_info and classifies it', () => {
    const gl: RendererInfoContext = {
      getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? EXT : null),
      getParameter: () => 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)'
    };
    expect(detectRenderCapability(gl)).toEqual({
      capability: 'hardware',
      rawRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)'
    });
  });

  it('returns unknown/null when the extension is gated/absent (blind detection)', () => {
    const gl: RendererInfoContext = { getExtension: () => null, getParameter: () => 'unused' };
    expect(detectRenderCapability(gl)).toEqual({ capability: 'unknown', rawRenderer: null });
  });

  it('returns unknown when the parameter is not a usable string', () => {
    const gl: RendererInfoContext = { getExtension: () => EXT, getParameter: () => '' };
    expect(detectRenderCapability(gl)).toEqual({ capability: 'unknown', rawRenderer: null });
  });

  it('never throws — a throwing context classifies unknown', () => {
    const gl: RendererInfoContext = {
      getExtension: () => {
        throw new Error('context lost');
      },
      getParameter: () => 'unused'
    };
    expect(detectRenderCapability(gl)).toEqual({ capability: 'unknown', rawRenderer: null });
  });
});

describe('resolveCapability (DD-023 §4 D1)', () => {
  it('an explicit hint is authoritative over detection', () => {
    expect(resolveCapability('hardware', 'software')).toBe('hardware');
    expect(resolveCapability('software', 'hardware')).toBe('software');
  });

  it("'auto' / undefined trusts detection", () => {
    expect(resolveCapability('auto', 'hardware')).toBe('hardware');
    expect(resolveCapability('auto', 'software')).toBe('software');
    expect(resolveCapability(undefined, 'hardware')).toBe('hardware');
  });

  it('unknown detection resolves conservatively to software', () => {
    expect(resolveCapability('auto', 'unknown')).toBe('software');
    expect(resolveCapability(undefined, 'unknown')).toBe('software');
  });
});
