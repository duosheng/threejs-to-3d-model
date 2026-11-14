using System;
using System.IO;
using UnityEngine;

// The subset of out/manifest.json the Unity tools read (JsonUtility ignores the other fields).
[Serializable] public class RigManifest
{
    public string asset;
    public string name;
    public string title;
    public RigBone[] bones;
    public string[] checkBones;
    public string[] facing;
    public RigClip[] clips;
    public RigBounds bounds;
    public RigShot[] shots;
    public RigBaked baked;

    public static RigManifest Load(string exportDir)
    {
        var m = JsonUtility.FromJson<RigManifest>(File.ReadAllText(Path.Combine(exportDir, "manifest.json")));
        if (m.baked == null || m.baked.fbx == null || string.IsNullOrEmpty(m.baked.fbx.asset))
            throw new InvalidDataException("manifest has no baked section; run npm run bake first");
        return m;
    }

    public string AssetDir => $"Assets/RigAssets/{name}";

    // glTF is right-handed with the model facing +Z; Unity imports mirror X.
    public static Vector3 FromGltf(float[] v) => new Vector3(-v[0], v[1], v[2]);
    public Vector3 Center => (FromGltf(bounds.min) + FromGltf(bounds.max)) * 0.5f;
    public Vector3 Size => new Vector3(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]);
    public float Extent => Mathf.Max(Size.x, Mathf.Max(Size.y, Size.z));

    public static Vector3 ViewDirection(string view)
    {
        switch (view)
        {
            case "side": return FromGltf(new[] { 1f, 0.22f, 0.05f }).normalized;
            case "back": return FromGltf(new[] { -0.6f, 0.35f, -0.75f }).normalized;
            default: return FromGltf(new[] { 0.6f, 0.35f, 0.75f }).normalized;
        }
    }
}

[Serializable] public class RigBone { public string name; public string parent; }
[Serializable] public class RigClip { public string name; public float duration; public bool loop; }
[Serializable] public class RigBounds { public float[] min; public float[] max; }
[Serializable] public class RigShot { public string clip; public float t; public string view; }
[Serializable] public class RigBaked { public RigFile glb; public RigFile fbx; public RigMaterial[] materials; }
[Serializable] public class RigFile { public string asset; }
[Serializable] public class RigMaterial { public string name; public float roughness; public float metallic; public float emissionStrength; }
