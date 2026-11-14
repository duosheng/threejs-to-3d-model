using System;
using System.Collections;
using System.IO;
using UnityEngine;

// Play-mode viewer: number keys switch clips on every model, left drag orbits, wheel zooms.
// Launched with -rigViewerCapture <dir>, it plays each clip, writes one PNG per clip and quits.
public class RigViewer : MonoBehaviour
{
    public Animator[] models;
    public string[] modelLabels;
    public string[] clips;
    public Vector3 target = new Vector3(0, 1f, 0);
    public float distance = 10f;
    public float yaw;
    public float pitch = 14f;
    public float labelHeight = 2f;

    int current;
    GUIStyle style;

    void Start()
    {
        Play(0);
        PlaceCamera();
        var capture = Arg("-rigViewerCapture");
        if (capture != null) StartCoroutine(Capture(capture));
    }

    void Update()
    {
        for (var i = 0; i < clips.Length && i < 9; i++)
            if (Input.GetKeyDown(KeyCode.Alpha1 + i) || Input.GetKeyDown(KeyCode.Keypad1 + i)) Play(i);
        if (Input.GetMouseButton(0))
        {
            yaw += Input.GetAxis("Mouse X") * 4f;
            pitch = Mathf.Clamp(pitch - Input.GetAxis("Mouse Y") * 3f, -5f, 80f);
        }
        distance *= 1f - Input.mouseScrollDelta.y * 0.08f;
        PlaceCamera();
    }

    void Play(int index)
    {
        current = index;
        foreach (var animator in models) animator.CrossFadeInFixedTime(clips[index], 0.15f, 0, 0f);
    }

    public void PlaceCamera()
    {
        var rotation = Quaternion.Euler(pitch, yaw + 180f, 0);
        transform.position = target - rotation * Vector3.forward * distance;
        transform.LookAt(target);
    }

    void OnGUI()
    {
        style ??= new GUIStyle(GUI.skin.label) { fontSize = 18, normal = { textColor = new Color(1f, 0.88f, 0.7f) } };
        GUI.Label(new Rect(16, 12, 1000, 30), $"当前动画：{clips[current]}   （数字键 1-{Mathf.Min(clips.Length, 9)} 切换，左键拖动旋转，滚轮缩放）", style);
        var cam = GetComponent<Camera>();
        for (var i = 0; i < models.Length; i++)
        {
            var screen = cam.WorldToScreenPoint(models[i].transform.position + Vector3.up * labelHeight);
            if (screen.z <= 0) continue;
            GUI.Label(new Rect(screen.x - 80, Screen.height - screen.y, 240, 30), modelLabels[i], style);
        }
    }

    IEnumerator Capture(string dir)
    {
        Directory.CreateDirectory(dir);
        var cam = GetComponent<Camera>();
        for (var i = 0; i < clips.Length; i++)
        {
            Play(i);
            yield return new WaitForSeconds(0.8f);
            yield return new WaitForEndOfFrame();
            var rt = new RenderTexture(1280, 720, 24) { antiAliasing = 4 };
            cam.targetTexture = rt;
            cam.Render();
            RenderTexture.active = rt;
            var tex = new Texture2D(1280, 720, TextureFormat.RGB24, false);
            tex.ReadPixels(new Rect(0, 0, 1280, 720), 0, 0);
            tex.Apply();
            File.WriteAllBytes(Path.Combine(dir, $"unity-viewer-{clips[i]}.png"), tex.EncodeToPNG());
            RenderTexture.active = null;
            cam.targetTexture = null;
            Destroy(rt);
            Destroy(tex);
            var states = string.Join(", ", Array.ConvertAll(models, m => $"{m.name}:{StateName(m)}"));
            Debug.Log($"RIG_VIEWER clip={clips[i]} states=[{states}]");
        }
#if UNITY_EDITOR
        UnityEditor.EditorApplication.Exit(0);
#else
        Application.Quit();
#endif
    }

    string StateName(Animator animator)
    {
        var info = animator.GetCurrentAnimatorStateInfo(0);
        foreach (var clip in clips)
            if (info.IsName(clip)) return $"{clip}@{info.normalizedTime:0.00}";
        return "?";
    }

    static string Arg(string name)
    {
        var args = Environment.GetCommandLineArgs();
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }
}
