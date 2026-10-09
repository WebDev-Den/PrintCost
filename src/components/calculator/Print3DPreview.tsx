import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Box, LoaderCircle, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Box3, BufferAttribute, BufferGeometry, GridHelper, Group, LineBasicMaterial, LineSegments, PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ParsedJob } from '../../domain/types.ts';
import type { PrintPreviewData } from '../../domain/printPreview.ts';
import { createPrintPreview } from '../../services/printPreviewService.ts';
import { Button } from '../common/Button.tsx';

interface Print3DPreviewProps {
  file: File;
  job: ParsedJob;
}

interface PreviewControls {
  reset(): void;
  zoom(factor: number): void;
}

export const Print3DPreview: React.FC<Print3DPreviewProps> = ({ file, job }) => {
  const [result, setResult] = useState<{ file: File; job: ParsedJob; data?: PrintPreviewData; error?: string } | null>(null);
  const [plateIndex, setPlateIndex] = useState(0);
  const [graphicsError, setGraphicsError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<PreviewControls | null>(null);
  const currentResult = result?.file === file && result.job === job ? result : null;
  const preview = currentResult?.data;
  const activePlate = preview?.plates.find(plate => plate.plateIndex === plateIndex) ?? preview?.plates[0];

  useEffect(() => {
    const controller = new AbortController();
    setGraphicsError(null);
    setIsReady(false);
    createPrintPreview(file, job, controller.signal).then(data => {
      if (!controller.signal.aborted) {
        setPlateIndex(data.plates[0]?.plateIndex ?? 0);
        setResult({ file, job, data });
      }
    }).catch(error => {
      if (!controller.signal.aborted) {
        setResult({ file, job, error: error instanceof Error ? error.message : 'Не вдалося побудувати 3D-прев’ю цього файлу.' });
      }
    });
    return () => controller.abort();
  }, [file, job]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activePlate?.groups.length || graphicsError) return;
    if (activePlate.groups.some(group => !(group.positions instanceof Float32Array) || group.positions.length % 6 !== 0 || !group.positions.every(Number.isFinite) || !/^#[\da-f]{6}$/i.test(group.colorHex))) {
      setIsReady(false);
      setGraphicsError('У файлі немає коректних координат або кольорів для 3D-прев’ю. Розрахунок залишається доступним.');
      return;
    }

    const scene = new Group();
    const model = new Group();
    const bounds = new Box3();
    const geometries: BufferGeometry[] = [];
    const materials: LineBasicMaterial[] = [];
    let renderer: WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let observer: ResizeObserver | undefined;
    let grid: GridHelper | undefined;
    let disposed = false;
    let canvas: HTMLCanvasElement | undefined;

    const render = () => {
      if (disposed || !renderer || renderer.getContext().isContextLost()) return;
      try { renderer.render(scene, camera); }
      catch { setGraphicsError('Не вдалося відобразити 3D-прев’ю. Розрахунок залишається доступним.'); }
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setGraphicsError('Браузер втратив доступ до 3D-графіки. Закрийте й знову відкрийте прев’ю; розрахунок залишається доступним.');
    };
    const camera = new PerspectiveCamera(45, 1, 0.01, 10_000);
    camera.up.set(0, 0, 1);
    let onKeyDown: ((event: KeyboardEvent) => void) | undefined;

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      controlsRef.current = null;
      observer?.disconnect();
      if (canvas) {
        canvas.removeEventListener('webglcontextlost', onContextLost);
        if (onKeyDown) canvas.removeEventListener('keydown', onKeyDown);
      }
      controls?.removeEventListener('change', render);
      controls?.dispose();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      grid?.geometry.dispose();
      if (grid) (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(material => material.dispose());
      renderer?.dispose();
      renderer?.forceContextLoss();
      canvas?.remove();
    };

    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      canvas = renderer.domElement;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-label', `3D-прев’ю: ${activePlate.plateName}. Стрілки — обертання; плюс і мінус — масштаб; Home — початковий вигляд.`);
      canvas.addEventListener('webglcontextlost', onContextLost);
      container.appendChild(canvas);

      for (const group of activePlate.groups) {
        if (!group.positions.length) continue;
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(group.positions, 3));
        geometry.computeBoundingBox();
        geometries.push(geometry);
        if (geometry.boundingBox) bounds.union(geometry.boundingBox);
        const material = new LineBasicMaterial({ color: group.colorHex });
        materials.push(material);
        model.add(new LineSegments(geometry, material));
      }
      if (bounds.isEmpty()) throw new Error('Empty preview');
      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      model.position.set(-center.x, -center.y, -bounds.min.z);
      scene.add(model);
      const radius = Math.max(size.length() / 2, 1);
      const gridSize = Math.max(Math.ceil(Math.max(size.x, size.y) * 1.2 / 10) * 10, 20);
      grid = new GridHelper(gridSize, 10, 0xa3a3a3, 0xa3a3a3);
      grid.rotation.x = Math.PI / 2;
      grid.position.z = -Math.max(radius / 1000, 0.001);
      scene.add(grid);

      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = false;
      controls.enablePan = true;
      controls.minPolarAngle = 0.02;
      controls.maxPolarAngle = Math.PI - 0.02;
      controls.minDistance = radius / 8;
      controls.maxDistance = radius * 100;
      controls.target.set(0, 0, size.z / 2);
      controls.addEventListener('change', render);
      camera.near = Math.max(radius / 1000, 0.001);
      camera.far = radius * 200;

      const reset = () => {
        const verticalFov = camera.fov * Math.PI / 180;
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
        const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.12;
        controls!.target.set(0, 0, size.z / 2);
        camera.position.copy(new Vector3(0.8, -1, 0.7).normalize().multiplyScalar(distance).add(controls!.target));
        controls!.update();
        render();
      };
      const zoom = (factor: number) => {
        const offset = camera.position.clone().sub(controls!.target);
        offset.setLength(Math.min(controls!.maxDistance, Math.max(controls!.minDistance, offset.length() * factor)));
        camera.position.copy(controls!.target).add(offset);
        controls!.update();
        render();
      };
      onKeyDown = event => {
        if (event.key === 'Home') reset();
        else if (event.key === '+' || event.key === '=') zoom(0.8);
        else if (event.key === '-' || event.key === '_') zoom(1.25);
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          const offset = camera.position.clone().sub(controls!.target);
          const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
          const axis = horizontal ? new Vector3(0, 0, 1) : new Vector3().crossVectors(offset, camera.up).normalize();
          const angle = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 0.15 : -0.15;
          offset.applyAxisAngle(axis, angle);
          camera.position.copy(controls!.target).add(offset);
          controls!.update();
          render();
        } else return;
        event.preventDefault();
      };
      canvas.addEventListener('keydown', onKeyDown);
      const resize = () => {
        if (disposed) return;
        const width = Math.max(container.clientWidth, 1);
        const height = Math.max(container.clientHeight, 1);
        renderer!.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        render();
      };
      resize();
      reset();
      observer = new ResizeObserver(resize);
      observer.observe(container);
      controlsRef.current = { reset, zoom };
      setIsReady(true);
    } catch {
      setIsReady(false);
      setGraphicsError('3D-прев’ю потребує підтримки WebGL 2 у браузері. Розрахунок залишається доступним.');
      cleanup();
    }
    return cleanup;
  }, [activePlate, graphicsError]);

  const warnings = [...new Set([...(preview?.warnings ?? []), ...(activePlate?.warnings ?? [])])];
  const error = currentResult?.error ?? graphicsError;
  const unavailable = activePlate?.unavailableReason ?? (!activePlate?.groups.length ? 'У цьому файлі немає доступних траєкторій екструзії для прев’ю.' : null);

  return (
    <section aria-label="3D-прев’ю завантаженого файлу" className="rounded-xl border border-neutral-200 bg-white p-5 shadow-2xs dark:border-neutral-800 dark:bg-neutral-900 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          <Box className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> 3D-прев’ю (траєкторії друку)
        </h3>
        {preview && preview.plates.length > 1 ? (
          <label className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
            Пластина
            <select aria-label="Пластина для 3D-прев’ю" value={activePlate?.plateIndex ?? ''} onChange={event => setPlateIndex(Number(event.target.value))} className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-800">
              {preview.plates.map(plate => <option key={plate.plateIndex} value={plate.plateIndex}>{plate.plateName}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {!currentResult ? (
        <div role="status" className="flex h-36 items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400"><LoaderCircle className="h-4 w-4 animate-spin" /> Будуємо 3D-прев’ю…</div>
      ) : error || unavailable ? (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200"><AlertCircle className="h-4 w-4 shrink-0" /> {error ?? unavailable}</p>
      ) : (
        <>
          <div ref={containerRef} className="h-72 sm:h-96 w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-500 dark:border-neutral-700" />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!isReady} leftIcon={<ZoomIn className="h-3.5 w-3.5" />} onClick={() => controlsRef.current?.zoom(0.8)}>Наблизити</Button>
            <Button type="button" variant="outline" size="sm" disabled={!isReady} leftIcon={<ZoomOut className="h-3.5 w-3.5" />} onClick={() => controlsRef.current?.zoom(1.25)}>Віддалити</Button>
            <Button type="button" variant="outline" size="sm" disabled={!isReady} leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => controlsRef.current?.reset()}>Початковий вигляд</Button>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Перетягніть для обертання, коліщатко або два пальці — масштаб. Клавіатура: стрілки, + / − та Home.</p>
          {activePlate ? <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">{activePlate.groups.map(group => <span key={group.trayId} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-neutral-400" style={{ backgroundColor: group.colorHex }} /> {group.trayId === 0 ? 'Службові траєкторії' : `Філамент #${group.trayId}`}</span>)}</div> : null}
        </>
      )}

      {warnings.length ? <ul className="list-inside list-disc space-y-1 text-xs text-amber-800 dark:text-amber-300">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}
      <p className="text-xs text-neutral-500 dark:text-neutral-400">Траєкторії також можуть включати підтримки, обвід, кайму та продувку. Файл обробляється лише у вашому браузері.</p>
    </section>
  );
};

export default Print3DPreview;
