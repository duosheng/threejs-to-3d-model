using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Animations;
using UnityEditor.SceneManagement;
using UnityEngine;

// Builds Assets/RigViewer/RigViewer.unity from the assets RigImportCheck imported: FBX and GLB side by side,
// one Animator per model (one-shot clips return to the first looping clip), lights, floor and an orbit camera.
// Batch: -executeMethod RigViewerBuilder.BuildBatch -rigExport <asset out/>
public static class RigViewerBuilder
{
    const string Dir = "Assets/RigViewer";
    const string MaterialDir = Dir + "/Materials";
    public const string ScenePath = Dir + "/RigViewer.unity";

    public static void BuildBatch()
    {
        var code = 0;
        try
        {
            Build(RigManifest.Load(Path.GetFullPath(Arg("-rigExport"))));
        }
        catch (Exception e)
        {
            Debug.LogException(e);
            code = 1;
        }
        EditorApplication.Exit(code);
    }

    // Editor (non-batch) entry used by unity.sh capture: open the scene and enter Play mode.
    public static void CapturePlayMode()
    {
        EditorSceneManager.OpenScene(ScenePath);
        EditorApplication.EnterPlaymode();
    }

    static void Build(RigManifest manifest)
    {
        PlayerSettings.colorSpace = ColorSpace.Linear;
        Directory.CreateDirectory(MaterialDir);
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var spacing = Mathf.Max(manifest.Size.x, manifest.Size.z * 0.6f) * 0.75f + manifest.Extent * 0.15f;
        // The camera looks down -Z at the models' faces, so world +X is screen left.
        var models = new[]
        {
            ("fbx", $"{manifest.AssetDir}/{manifest.baked.fbx.asset}", spacing, "FBX（Unity 自带导入）"),
            ("glb", $"{manifest.AssetDir}/{manifest.baked.glb.asset}", -spacing, "GLB（glTFast）"),
        };
        var clipNames = manifest.clips.Select(c => c.name).ToArray();
        var animators = new List<Animator>();
        foreach (var (label, path, x, caption) in models)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) throw new FileNotFoundException($"{path} missing, run unity.sh check first");
            var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
            go.name = caption;
            go.transform.position = new Vector3(x, 0, 0);
            var animator = go.GetComponent<Animator>() ?? go.AddComponent<Animator>();
            animator.runtimeAnimatorController = BuildController(manifest, label, path);
            animator.applyRootMotion = false;
            animator.cullingMode = AnimatorCullingMode.AlwaysAnimate;
            var smr = go.GetComponentInChildren<SkinnedMeshRenderer>();
            smr.updateWhenOffscreen = true;
            if (label == "fbx") smr.sharedMaterials = smr.sharedMaterials.Select(m => TuneFbxMaterial(m, manifest)).ToArray();
            animators.Add(animator);
        }

        RenderSettings.skybox = null;
        RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
        RenderSettings.ambientLight = new Color(0.3f, 0.3f, 0.32f);
        foreach (var (name, euler, color, intensity) in new[]
        {
            ("Key Light", new Vector3(40, 200, 0), new Color(1f, 0.95f, 0.88f), 1.5f),
            ("Rim Light", new Vector3(20, 20, 0), new Color(0.65f, 0.75f, 1f), 1.0f),
        })
        {
            var light = new GameObject(name).AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = color;
            light.intensity = intensity;
            light.shadows = LightShadows.Soft;
            light.transform.rotation = Quaternion.Euler(euler);
        }

        var floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
        floor.name = "Floor";
        floor.transform.localScale = Vector3.one * manifest.Extent * 1.2f;
        floor.GetComponent<MeshRenderer>().sharedMaterial = SaveMaterial("floor", m =>
        {
            m.color = new Color(0.12f, 0.12f, 0.13f);
            m.SetFloat("_Glossiness", 0.2f);
        });

        var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
        var cam = camGo.AddComponent<Camera>();
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.07f, 0.07f, 0.08f);
        cam.fieldOfView = 35;
        cam.nearClipPlane = manifest.Extent * 0.02f;
        cam.farClipPlane = manifest.Extent * 80f;
        var viewer = camGo.AddComponent<RigViewer>();
        viewer.models = animators.ToArray();
        viewer.modelLabels = models.Select(m => m.Item4).ToArray();
        viewer.clips = clipNames;
        viewer.target = new Vector3(0, manifest.Center.y, 0);
        viewer.distance = (spacing * 2 + manifest.Extent) * 1.45f;
        viewer.labelHeight = manifest.Size.y * 1.15f;
        viewer.PlaceCamera();

        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        AssetDatabase.SaveAssets();
        Debug.Log($"RIG_VIEWER_BUILT {ScenePath} asset={manifest.name} clips={string.Join(",", clipNames)}");
    }

    static AnimatorController BuildController(RigManifest manifest, string label, string modelPath)
    {
        var path = $"{Dir}/{manifest.name}-{label}.controller";
        AssetDatabase.DeleteAsset(path);
        var controller = AnimatorController.CreateAnimatorControllerAtPath(path);
        var machine = controller.layers[0].stateMachine;
        var clips = AssetDatabase.LoadAllAssetsAtPath(modelPath).OfType<AnimationClip>()
            .Where(c => !c.name.StartsWith("__preview__")).ToDictionary(c => c.name);
        var states = new Dictionary<string, AnimatorState>();
        foreach (var spec in manifest.clips)
        {
            if (!clips.TryGetValue(spec.name, out var clip)) throw new InvalidDataException($"{modelPath} has no clip {spec.name}");
            var state = machine.AddState(spec.name);
            state.motion = clip;
            states[spec.name] = state;
        }
        var home = (manifest.clips.FirstOrDefault(c => c.loop) ?? manifest.clips[0]).name;
        machine.defaultState = states[home];
        foreach (var spec in manifest.clips.Where(c => !c.loop))
        {
            var back = states[spec.name].AddTransition(states[home]);
            back.hasExitTime = true;
            back.exitTime = 0.92f;
            back.hasFixedDuration = true;
            back.duration = 0.15f;
        }
        return controller;
    }

    // FBX carries no roughness or emission strength into Standard, so restore them from the bake manifest.
    static Material TuneFbxMaterial(Material source, RigManifest manifest)
    {
        var p = manifest.baked.materials?.FirstOrDefault(m => m.name == source.name);
        if (p == null) return source;
        return SaveMaterial($"{manifest.name}-fbx-{source.name}", m =>
        {
            m.CopyPropertiesFromMaterial(source);
            m.color = Color.white;
            m.SetFloat("_Glossiness", 1f - p.roughness);
            m.SetFloat("_GlossMapScale", 1f - p.roughness);
            m.SetFloat("_Metallic", p.metallic);
            m.SetColor("_EmissionColor", Color.white * p.emissionStrength);
            if (p.emissionStrength > 0)
            {
                m.EnableKeyword("_EMISSION");
                m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            }
            else
            {
                m.DisableKeyword("_EMISSION");
                m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.EmissiveIsBlack;
            }
        });
    }

    static Material SaveMaterial(string name, Action<Material> setup)
    {
        var path = $"{MaterialDir}/{name}.mat";
        AssetDatabase.DeleteAsset(path);
        var material = new Material(Shader.Find("Standard")) { name = name };
        setup(material);
        AssetDatabase.CreateAsset(material, path);
        return material;
    }

    static string Arg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        var i = Array.IndexOf(args, name);
        if (i < 0 || i + 1 >= args.Length) throw new ArgumentException($"missing {name}");
        return args[i + 1];
    }
}
