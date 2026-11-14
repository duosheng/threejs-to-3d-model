#!/bin/sh
# Unity import check / preview scene for the baked assets in out/.
#   sh unity/unity.sh check      batch import FBX + GLB, compare bones, render shots -> out/unity/
#   sh unity/unity.sh viewer     build Assets/RigViewer/RigViewer.unity in the shared project
#   sh unity/unity.sh capture    viewer + open the editor, enter Play mode, save one PNG per clip, quit
# Env: UNITY (editor binary), RIG_UNITY_PROJECT (shared project, created on first use),
#      GLTFAST_VERSION (default 6.14.1, the newest that supports 2022.3.62).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
asset=$(cd "$here/.." && pwd)
out=${RIG_OUT:-$asset/out}
unity=${UNITY:-/Applications/Unity/Unity.app/Contents/MacOS/Unity}
proj=${RIG_UNITY_PROJECT:-$HOME/.rig-pipeline/unity-project}
gltfast=${GLTFAST_VERSION:-6.14.1}
report="$out/unity"
mode=${1:-check}
mkdir -p "$report"

[ -x "$unity" ] || { echo "Unity editor not found at $unity; set UNITY=..." >&2; exit 1; }
[ -f "$out/manifest.json" ] || { echo "no $out/manifest.json; run npm run pipeline first" >&2; exit 1; }
if [ -f "$proj/Temp/UnityLockfile" ] && lsof "$proj/Temp/UnityLockfile" >/dev/null 2>&1; then
  echo "$proj is open in a Unity editor; close it first" >&2
  exit 1
fi

if [ ! -f "$proj/ProjectSettings/ProjectVersion.txt" ]; then
  echo "creating Unity project $proj (first run only, takes a few minutes)"
  mkdir -p "$(dirname "$proj")"
  "$unity" -batchmode -quit -createProject "$proj" -logFile "$report/unity-create.log"
fi
node -e '
const fs = require("fs");
const [file, version] = process.argv.slice(1);
const m = JSON.parse(fs.readFileSync(file, "utf8"));
if (m.dependencies["com.unity.cloud.gltfast"] !== version) {
  m.dependencies["com.unity.cloud.gltfast"] = version;
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
}' "$proj/Packages/manifest.json" "$gltfast"
mkdir -p "$proj/Assets/RigPipeline/Editor" "$proj/Assets/RigPipeline/Runtime"
cp "$here"/Editor/*.cs "$proj/Assets/RigPipeline/Editor/"
cp "$here"/Runtime/*.cs "$proj/Assets/RigPipeline/Runtime/"

run_check() {
  status=0
  "$unity" -batchmode -projectPath "$proj" -executeMethod RigImportCheck.Run \
    -rigExport "$out" -rigReport "$report" -logFile "$report/unity-check.log" || status=$?
  if [ ! -f "$report/unity-report.json" ] || ! grep -q RIG_REPORT "$report/unity-check.log"; then
    echo "Unity check did not produce a report; see $report/unity-check.log" >&2
    exit 1
  fi
  node -e '
const r = require(process.argv[1]);
console.log(`Unity ${r.unityVersion} ${r.graphicsDevice} asset=${r.asset} passed=${r.passed}`);
for (const a of r.assets) console.log(a.error ? `  ${a.label}: ERROR ${a.error}` :
  `  ${a.label}: passed=${a.passed} bones=${a.bones} verts=${a.vertices} tris=${a.triangles} clips=${a.clips.map((c) => c.name + (c.isLooping ? "(loop)" : "")).join(",")} missing=[${a.missingClips}] +Z=${a.facesPositiveZ} axis=${a.bestAxisMapping} maxErr=${(a.maxBoneErrorMeters * 1e6).toFixed(1)}um`);' "$report/unity-report.json"
  return $status
}

run_viewer() {
  "$unity" -batchmode -projectPath "$proj" -executeMethod RigViewerBuilder.BuildBatch \
    -rigExport "$out" -logFile "$report/unity-viewer-build.log"
  grep -q RIG_VIEWER_BUILT "$report/unity-viewer-build.log"
  echo "viewer scene: $proj/Assets/RigViewer/RigViewer.unity"
}

case "$mode" in
  check) run_check ;;
  viewer) run_viewer ;;
  capture)
    run_viewer
    "$unity" -projectPath "$proj" -executeMethod RigViewerBuilder.CapturePlayMode \
      -rigViewerCapture "$report/viewer" -logFile "$report/unity-viewer-capture.log"
    grep "RIG_VIEWER clip=" "$report/unity-viewer-capture.log"
    ;;
  *) echo "usage: $0 check|viewer|capture" >&2; exit 2 ;;
esac
