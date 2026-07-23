/**
 * DD-007 phase 3 parity demo (issue #106): the packaged Vue COMPONENT drives the whole
 * pipeline — corpus select, layer/scrub props, simulated DD-006 progress — with the
 * D2 DEFAULT (batteries) worker path under real Vite. No raw session/renderer imports:
 * if the component can't do it here, the component is missing something.
 */
import { createApp, defineComponent, h, ref, shallowRef, computed } from 'vue';
import { GcodePreview } from '@chestnutlabs/gcode-preview-vue';

const CORPUS = ['easel.gcode', 'calicat.gcode', '3DBenchy.gcode', 'vase.gcode', 'screw.gcode'];

const App = defineComponent({
  setup() {
    const fixture = ref(CORPUS[0]);
    const source = shallowRef(null);
    const layerCount = ref(0);
    const segmentCount = ref(0);
    const lastLayer = ref(0);
    const scrub = ref(null);
    const progressObs = shallowRef(null);
    const log = ref('Pick a fixture and press Load.');
    const preview = ref(null); // template ref → exposed handle
    let simTimer = null;
    let simFraction = 0;

    const append = (s) => {
      log.value = `${s}\n${log.value}`.split('\n').slice(0, 14).join('\n');
    };

    async function load() {
      stopSim();
      const res = await fetch(`./${fixture.value}`);
      const buf = await res.arrayBuffer();
      source.value = new Uint8Array(buf); // prop change → component re-parses
    }

    function stopSim() {
      if (simTimer !== null) clearInterval(simTimer);
      simTimer = null;
      progressObs.value = null;
    }

    function playSim() {
      if (simTimer !== null) {
        stopSim();
        return;
      }
      simFraction = 0;
      simTimer = setInterval(() => {
        simFraction = Math.min(1, simFraction + 0.01);
        progressObs.value = {
          v: 1,
          timestampMs: Date.now(),
          state: simFraction >= 1 ? 'complete' : 'printing',
          position: { percent: simFraction, percentBasis: 'bytes' }
        };
        if (simFraction >= 1) {
          clearInterval(simTimer);
          simTimer = null;
        }
      }, 100);
    }

    const scrubLabel = computed(() =>
      scrub.value === null ? 'all' : `${scrub.value.toLocaleString()} / ${segmentCount.value.toLocaleString()}`
    );

    return () =>
      h('div', { style: 'display: contents' }, [
        h('aside', [
          h('h2', 'Vue component parity'),
          h('label', [
            'Fixture ',
            h(
              'select',
              {
                value: fixture.value,
                onChange: (e) => (fixture.value = e.target.value)
              },
              CORPUS.map((f) => h('option', { value: f }, f))
            )
          ]),
          h('button', { onClick: load }, 'Load'),
          h('label', [
            `Last layer: ${lastLayer.value} / ${Math.max(0, layerCount.value - 1)}`,
            h('input', {
              type: 'range',
              min: 0,
              max: Math.max(0, layerCount.value - 1),
              value: lastLayer.value,
              onInput: (e) => (lastLayer.value = Number(e.target.value))
            })
          ]),
          h('label', [
            `Scrub: ${scrubLabel.value}`,
            h('input', {
              type: 'range',
              min: 0,
              max: segmentCount.value,
              value: scrub.value ?? segmentCount.value,
              onInput: (e) => {
                const v = Number(e.target.value);
                scrub.value = v >= segmentCount.value ? null : v;
              }
            })
          ]),
          h('button', { onClick: playSim }, simTimer === null ? 'Play simulated progress' : 'Stop'),
          h('pre', { id: 'log' }, log.value)
        ]),
        h('main', [
          h(GcodePreview, {
            ref: preview,
            source: source.value,
            layerRange: layerCount.value > 0 ? [0, lastLayer.value] : null,
            scrub: scrub.value,
            progress: progressObs.value,
            quality: 'auto',
            onReady: (s) => {
              layerCount.value = s.layers;
              segmentCount.value = s.segments;
              lastLayer.value = Math.max(0, s.layers - 1);
              scrub.value = null;
              append(`ready: ${s.segments.toLocaleString()} segments, ${s.layers} layers`);
            },
            'onParse-error': (e) => append(`parse-error: ${e.code} ${e.message}`),
            'onBuild-complete': (e) => append(`build-complete: ${e.quality}`),
            'onQuality-fallback': (e) => append(`quality-fallback: ${e.from} -> ${e.to}`),
            'onProgress-presentation-changed': (e) =>
              append(`progress shown as: ${e.mode}${e.reason ? ` (${e.reason})` : ''}`),
            onDisclosure: (t) => t && append(`disclosure: ${t}`),
            'onMachine-geometry-discovered': () => append('bed discovered (consumer volume kept)'),
            onError: (e) => append(`error: ${e.code}`)
          })
        ])
      ]);
  }
});

const app = createApp(App);
const vm = app.mount('#app');
window.vueDemo = { app, vm };
