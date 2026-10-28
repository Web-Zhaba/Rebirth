import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

const SAMPLE_MS = 1000;
const HISTORY = 120;
const LONG_FRAME_MS = 50;

export function FpsCounter() {
  const fps = useSignal(0);
  const frameMs = useSignal(0);
  const worstMs = useSignal(0);

  useEffect(() => {
    let raf = 0;
    let lastFrame = performance.now();
    let lastUpdate = lastFrame;

    const samples: number[] = [];

    const frame = (now: number) => {
      const dt = now - lastFrame;
      lastFrame = now;

      // Игнорируем огромный первый интервал и паузы,
      // например после переключения вкладки.
      if (dt > 0 && dt < 1000) {
        samples.push(dt);

        if (samples.length > HISTORY) {
          samples.shift();
        }
      }

      if (now - lastUpdate >= SAMPLE_MS && samples.length > 0) {
        const total = samples.reduce((sum, value) => sum + value, 0);
        const average = total / samples.length;

        fps.value = Math.round(1000 / average);
        frameMs.value = Math.round(average * 10) / 10;

        let worst = 0;

        for (const value of samples) {
          if (value > worst) {
            worst = value;
          }
        }

        worstMs.value = Math.round(worst * 10) / 10;

        lastUpdate = now;
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, []);

  const badFrame = worstMs.value >= LONG_FRAME_MS;

  return (
    <div class="fps" aria-hidden="true">
      <span class="fps-num">{fps}</span> fps
      {" · "}
      <span>{frameMs}</span> ms
      {badFrame && (
        <>
          {" · max "}
          <span>{worstMs}</span> ms
        </>
      )}
    </div>
  );
}