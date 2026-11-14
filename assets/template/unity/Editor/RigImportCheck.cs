using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using Unity.Jobs.LowLevel.Unsafe;
using UnityEngine;

// Batch entry: Unity -batchmode -projectPath <project> -executeMethod RigImportCheck.Run
//   -rigExport <asset out/> -rigReport <report dir>
// Imports the baked FBX (Unity importer) and GLB (glTFast), compares bones against
// reference-samples.json, renders the manifest shots and writes unity-report.json.
public static class RigImportCheck
{
    const int RenderWidth = 1280;
    const int RenderHeight = 720;
    const float MaxBoneErrorMeters = 0.001f;

    [Serializable] class RefClip { public string name; public float duration; public float[] times; public float[] positions; }
    [Serializable] class RefData { public string[] bones; public RefClip[] clips; }

    [Serializable] class ClipInfo { public string name; public float length; public float frameRate; public bool isLooping; }
    [Serializable] class MaterialInfo { public string name; public string shader; public string[] textures; public bool emissionKeyword; }
    [Serializable] class AxisFit { public string mapping; public float maxErrorMeters; }
    [Serializable]
    class AssetReport
    {
        public string label;
        public string error;
        public bool passed;
        public string importNote;
        public string assetPath;
        public string importer;
        public int bones;
        public int vertices;
        public int triangles;
        public int subMeshes;
        public MaterialInfo[] materials;
        public ClipInfo[] clips;
        public string[] missingClips;
        public bool facesPositiveZ;
        public AxisFit[] axisFits;
        public string bestAxisMapping;
        public float maxBoneErrorMeters;
        public string worstSample;
        public string[] renders;
    }
    [Serializable] class Report { public string unityVersion; public string graphicsDevice; public string asset; public bool passed; public AssetReport[] assets; }

    static readonly (string name, Func<Vector3, Vector3> map)[] AxisMaps =
    {
        ("x->-x", v => new Vector3(-v.x, v.y, v.z)),
        ("z->-z", v => new Vector3(v.x, v.y, -v.z)),
        ("identity", v => v),
        ("x,z->-x,-z", v => new Vector3(-v.x, v.y, -v.z)),
    };

    public static void Run()
    {
        var code = 0;
        try
        {
            var exportDir = Path.GetFullPath(Arg("-rigExport"));
            var outDir = Path.GetFullPath(Arg("-rigReport"));
            Directory.CreateDirectory(outDir);
            PlayerSettings.colorSpace = ColorSpace.Linear;
            EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var manifest = RigManifest.Load(exportDir);
            Directory.CreateDirectory(manifest.AssetDir);
            var reference = JsonUtility.FromJson<RefData>(File.ReadAllText(Path.Combine(exportDir, "reference-samples.json")));

            var assets = new[]
            {
                Guard("fbx", () => CheckFbx(Path.Combine(exportDir, manifest.baked.fbx.asset), manifest, reference, outDir)),
                Guard("glb", () => CheckGlb(Path.Combine(exportDir, manifest.baked.glb.asset), manifest, reference, outDir)),
            };
            var report = new Report
            {
                unityVersion = Application.unityVersion,
                graphicsDevice = SystemInfo.graphicsDeviceType.ToString(),
                asset = manifest.name,
                passed = assets.All(a => a.passed),
                assets = assets,
            };
            if (!report.passed) code = 1;
            File.WriteAllText(Path.Combine(outDir, "unity-report.json"), JsonUtility.ToJson(report, true));
            Debug.Log("RIG_REPORT " + JsonUtility.ToJson(report));
        }
        catch (Exception e)
        {
            Debug.LogException(e);
            code = 1;
        }
        EditorApplication.Exit(code);
    }

    static string Arg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        var i = Array.IndexOf(args, name);
        if (i < 0 || i + 1 >= args.Length) throw new ArgumentException($"missing {name}");
        return args[i + 1];
    }

    static AssetReport Guard(string label, Func<AssetReport> check)
    {
        try
        {
            return check();
        }
        catch (Exception e)
        {
            Debug.LogException(e);
            return new AssetReport { label = label, error = e.Message };
        }
    }

    static string CopyIn(string source, RigManifest manifest)
    {
        var dest = $"{manifest.AssetDir}/{Path.GetFileName(source)}";
        File.Copy(source, dest, true);
        AssetDatabase.ImportAsset(dest, ImportAssetOptions.ForceUpdate);
        return dest;
    }

    static AnimationClip[] ClipsAt(string path) =>
        AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().Where(c => !c.name.StartsWith("__preview__")).ToArray();

    static AssetReport CheckFbx(string source, RigManifest manifest, RefData reference, string outDir)
    {
        var path = CopyIn(source, manifest);
        var importer = (ModelImporter)AssetImporter.GetAtPath(path);
        importer.animationType = ModelImporterAnimationType.Generic;
        importer.avatarSetup = ModelImporterAvatarSetup.CreateFromThisModel;
        importer.importAnimation = true;
        importer.bakeAxisConversion = true;
        importer.animationCompression = ModelImporterAnimationCompression.Off;
        importer.materialImportMode = ModelImporterMaterialImportMode.ImportStandard;
        importer.materialSearch = ModelImporterMaterialSearch.Local;
        importer.SaveAndReimport();

        var textureDir = $"{manifest.AssetDir}/fbx-textures";
        Directory.CreateDirectory(textureDir);
        importer.ExtractTextures(textureDir);
        AssetDatabase.Refresh();
        foreach (var guid in AssetDatabase.FindAssets("t:Texture2D", new[] { textureDir }))
        {
            var texPath = AssetDatabase.GUIDToAssetPath(guid);
            var texImporter = (TextureImporter)AssetImporter.GetAtPath(texPath);
            var isNormal = Path.GetFileNameWithoutExtension(texPath).EndsWith("_normal");
            texImporter.textureType = isNormal ? TextureImporterType.NormalMap : TextureImporterType.Default;
            texImporter.sRGBTexture = !isNormal;
            texImporter.SaveAndReimport();
        }

        var looping = new HashSet<string>(manifest.clips.Where(c => c.loop).Select(c => c.name));
        importer.clipAnimations = importer.defaultClipAnimations.Select(c =>
        {
            c.name = c.takeName.Split('|').Last();
            c.loopTime = looping.Contains(c.name);
            return c;
        }).ToArray();
        importer.SaveAndReimport();
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        var report = Inspect("fbx", path, "ModelImporter (Generic, bakeAxisConversion)", prefab, ClipsAt(path), manifest, reference, outDir);
        report.importNote = "animationCompression=Off, embedded textures extracted, *_normal marked NormalMap";
        return report;
    }

    // glTFast schedules one bone-weight job per primitive into a shared buffer; the editor job
    // debugger rejects that pattern for multi-material skinned meshes, players have no such check.
    static AssetReport CheckGlb(string source, RigManifest manifest, RefData reference, string outDir)
    {
        var debugger = JobsUtility.JobDebuggerEnabled;
        JobsUtility.JobDebuggerEnabled = false;
        string path;
        try
        {
            path = CopyIn(source, manifest);
        }
        finally
        {
            JobsUtility.JobDebuggerEnabled = debugger;
        }
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
        var importer = AssetImporter.GetAtPath(path);
        if (prefab == null) throw new InvalidOperationException($"{importer?.GetType().Name ?? "no importer"} produced no prefab for {path}");
        var report = Inspect("glb", path, $"{importer.GetType().FullName} (glTFast)", prefab, ClipsAt(path), manifest, reference, outDir);
        report.importNote = "imported with JobsUtility.JobDebuggerEnabled=false (glTFast multi-primitive skin job false positive)";
        return report;
    }

    static AssetReport Inspect(string label, string path, string importer, GameObject prefab, AnimationClip[] clips, RigManifest manifest, RefData reference, string outDir)
    {
        var report = new AssetReport { label = label, assetPath = path, importer = importer };
        var go = (GameObject)UnityEngine.Object.Instantiate(prefab);
        go.transform.position = Vector3.zero;
        var smr = go.GetComponentInChildren<SkinnedMeshRenderer>();
        smr.updateWhenOffscreen = true;
        var mesh = smr.sharedMesh;
        report.bones = smr.bones.Length;
        report.vertices = mesh.vertexCount;
        report.subMeshes = mesh.subMeshCount;
        report.triangles = mesh.triangles.Length / 3;
        report.materials = smr.sharedMaterials.Select(m => new MaterialInfo
        {
            name = m.name,
            shader = m.shader.name,
            textures = m.GetTexturePropertyNames().Where(p => m.GetTexture(p) != null).Select(p => $"{p}={m.GetTexture(p).name}").ToArray(),
            emissionKeyword = m.IsKeywordEnabled("_EMISSION"),
        }).ToArray();
        report.clips = clips.Select(c => new ClipInfo { name = c.name, length = c.length, frameRate = c.frameRate, isLooping = c.isLooping }).ToArray();
        report.missingClips = manifest.clips.Select(c => c.name).Where(n => clips.All(c => c.name != n)).ToArray();

        var bones = reference.bones.Select(n => Find(go.transform, n) ?? throw new InvalidDataException($"bone {n} missing")).ToArray();
        var samples = new List<(string tag, Vector3 unity, Vector3 gltf)>();
        foreach (var rc in reference.clips)
        {
            var clip = clips.FirstOrDefault(c => c.name == rc.name);
            if (clip == null) continue;
            for (var k = 0; k < rc.times.Length; k++)
            {
                var t = rc.duration > 0 ? rc.times[k] / rc.duration * clip.length : 0;
                clip.SampleAnimation(go, t);
                for (var b = 0; b < bones.Length; b++)
                {
                    var i = (k * bones.Length + b) * 3;
                    samples.Add(($"{rc.name}@{rc.times[k]:0.00}s/{reference.bones[b]}", bones[b].position,
                        new Vector3(rc.positions[i], rc.positions[i + 1], rc.positions[i + 2])));
                }
            }
        }
        report.axisFits = AxisMaps.Select(m => new AxisFit
        {
            mapping = m.name,
            maxErrorMeters = samples.Count == 0 ? float.NaN : samples.Max(s => (m.map(s.gltf) - s.unity).magnitude),
        }).ToArray();
        var best = report.axisFits.OrderBy(f => f.maxErrorMeters).First();
        report.bestAxisMapping = best.mapping;
        report.maxBoneErrorMeters = best.maxErrorMeters;
        var bestMap = AxisMaps.First(m => m.name == best.mapping).map;
        if (samples.Count > 0) report.worstSample = samples.OrderByDescending(s => (bestMap(s.gltf) - s.unity).magnitude).First().tag;

        var first = clips.FirstOrDefault(c => c.name == manifest.clips[0].name);
        if (first != null) first.SampleAnimation(go, 0);
        report.facesPositiveZ = Find(go.transform, manifest.facing[0]).position.z > Find(go.transform, manifest.facing[1]).position.z;
        report.passed = report.missingClips.Length == 0 && report.facesPositiveZ && report.bestAxisMapping == "x->-x"
            && report.maxBoneErrorMeters < MaxBoneErrorMeters && report.bones == manifest.bones.Length;

        report.renders = Render(go, smr, clips, manifest, label, outDir);
        UnityEngine.Object.DestroyImmediate(go);
        return report;
    }

    static Transform Find(Transform root, string name)
    {
        if (root.name == name) return root;
        foreach (Transform child in root)
        {
            var hit = Find(child, name);
            if (hit != null) return hit;
        }
        return null;
    }

    // Batch-mode Camera.Render does not refresh GPU skinning, so each pose is CPU-baked into a static stand-in.
    static string[] Render(GameObject go, SkinnedMeshRenderer smr, AnimationClip[] clips, RigManifest manifest, string label, string outDir)
    {
        var standIn = new GameObject("posed");
        var standInFilter = standIn.AddComponent<MeshFilter>();
        var standInRenderer = standIn.AddComponent<MeshRenderer>();
        standInRenderer.sharedMaterials = smr.sharedMaterials;
        var posed = new Mesh();
        smr.enabled = false;
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.3f, 0.3f, 0.32f);
        var lights = new List<GameObject>();
        foreach (var (euler, color, intensity) in new[]
        {
            (new Vector3(40, 200, 0), new Color(1f, 0.95f, 0.88f), 1.5f),
            (new Vector3(20, 20, 0), new Color(0.65f, 0.75f, 1f), 1.0f),
        })
        {
            var lightGo = new GameObject("light");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = color;
            light.intensity = intensity;
            light.shadows = LightShadows.Soft;
            lightGo.transform.rotation = Quaternion.Euler(euler);
            lights.Add(lightGo);
        }
        var camGo = new GameObject("cam");
        var cam = camGo.AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.07f, 0.07f, 0.08f);
        cam.fieldOfView = 32;
        cam.nearClipPlane = manifest.Extent * 0.02f;
        cam.farClipPlane = manifest.Extent * 60f;
        var rt = new RenderTexture(RenderWidth, RenderHeight, 24, RenderTextureFormat.ARGB32) { antiAliasing = 4 };
        cam.targetTexture = rt;
        var paths = new List<string>();
        foreach (var shot in manifest.shots)
        {
            var clip = clips.FirstOrDefault(c => c.name == shot.clip);
            if (clip == null) continue;
            clip.SampleAnimation(go, shot.t * clip.length);
            smr.BakeMesh(posed, true);
            standInFilter.sharedMesh = posed;
            standIn.transform.SetPositionAndRotation(smr.transform.position, smr.transform.rotation);
            cam.transform.position = manifest.Center + RigManifest.ViewDirection(shot.view) * manifest.Extent * 2.8f;
            cam.transform.LookAt(manifest.Center);
            cam.Render();
            RenderTexture.active = rt;
            var tex = new Texture2D(RenderWidth, RenderHeight, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, RenderWidth, RenderHeight), 0, 0);
            tex.Apply();
            var file = Path.Combine(outDir, $"unity-{label}-{shot.clip}-{shot.t}-{shot.view}.png");
            File.WriteAllBytes(file, tex.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(tex);
            paths.Add(file);
        }
        RenderTexture.active = null;
        cam.targetTexture = null;
        UnityEngine.Object.DestroyImmediate(rt);
        UnityEngine.Object.DestroyImmediate(camGo);
        foreach (var l in lights) UnityEngine.Object.DestroyImmediate(l);
        UnityEngine.Object.DestroyImmediate(standIn);
        UnityEngine.Object.DestroyImmediate(posed);
        smr.enabled = true;
        return paths.ToArray();
    }
}
