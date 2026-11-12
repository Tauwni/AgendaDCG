using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Windows.Media.Core;
using Windows.Media.Playback;
using Windows.Media.SpeechSynthesis;
using UglyToad.PdfPig;
using static AgendaDCG.Ui;

namespace AgendaDCG;

/// Lecture à voix haute des PDF avec la voix intégrée de Windows (gratuit, sans limite).
public static class Reader
{
    static readonly SpeechSynthesizer Synth = new();
    static readonly Windows.Media.Playback.MediaPlayer Player = new();
    static List<string> chunks = new();
    static int pos, token;
    static bool playing;
    static double rate = 1;
    static string? title;
    static string key = "";
    static readonly string PosFile = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AgendaDCG", "lecture.json");
    static Dictionary<string, int> LoadPos() { try { return System.Text.Json.JsonSerializer.Deserialize<Dictionary<string, int>>(System.IO.File.ReadAllText(PosFile)) ?? new(); } catch { return new(); } }
    static void Save() { if (key == "") return; try { var d = LoadPos(); d[key] = pos; System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(PosFile)!); System.IO.File.WriteAllText(PosFile, System.Text.Json.JsonSerializer.Serialize(d)); } catch { } }
    public static readonly Border Bar = new() { CornerRadius = new CornerRadius(22), Padding = new Thickness(14, 6, 8, 6), Background = new SolidColorBrush(Color.FromArgb(240, 30, 30, 32)), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, 0, 70), Visibility = Visibility.Collapsed };

    static Reader()
    {
        var fr = SpeechSynthesizer.AllVoices.Where(v => v.Language.StartsWith("fr", StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(v => (v.DisplayName.Contains("Natural") || v.DisplayName.Contains("Online") ? 4 : 0) + (v.Language == "fr-FR" ? 1 : 0)).FirstOrDefault();
        if (fr != null) Synth.Voice = fr;
        Player.MediaEnded += (_, _) => Application.Current.Dispatcher.Invoke(() => { var my = token; if (!playing) return; pos++; _ = Speak(my); });
    }

    public static void Read(string path, string name, string fileKey = "")
    {
        string text;
        using (var doc = PdfDocument.Open(path))
            text = string.Join("\n\n", doc.GetPages().Select(p => string.Join("\n", p.GetWords().GroupBy(w => Math.Round(w.BoundingBox.Bottom)).OrderByDescending(g => g.Key).Select(g => string.Join(" ", g.OrderBy(w => w.BoundingBox.Left).Select(w => w.Text))))));
        text = Regex.Replace(text, @"(\w)-\n(\w)", "$1$2");
        text = Regex.Replace(text, "[•▪●◦■□►➢✓]", " ");
        text = Regex.Replace(text, @"([^.!?:;\n])\n(?=[a-zà-ÿ])", "$1 ");
        chunks = Split(text);
        if (string.Concat(chunks).Length < 80) throw new Exception("Ce PDF est une image (scan) : pas de texte à lire");
        title = name; key = fileKey;
        var saved = fileKey != "" && LoadPos().TryGetValue(fileKey, out var sp) ? sp : 0;
        pos = saved > 0 && saved < chunks.Count - 1 ? saved : 0; // reprise là où on s'était arrêté
        Play();
    }

    static List<string> Split(string text)
    {
        var out_ = new List<string>();
        foreach (var para in text.Split('\n'))
            foreach (Match m in Regex.Matches(para, @"[^.!?]+[.!?]*\s*"))
            {
                var t = Regex.Replace(m.Value, @"\s+", " ").Trim();
                while (t.Length > 300) { var k = t.LastIndexOf(' ', 300); if (k < 80) k = 300; out_.Add(t[..k]); t = t[k..].Trim(); }
                if (Regex.IsMatch(t, @"[\p{L}\d]")) out_.Add(t);
            }
        return out_;
    }

    static async Task Speak(int my)
    {
        if (pos >= chunks.Count) { pos = 0; Stop(); return; }
        Save();
        Synth.Options.SpeakingRate = rate;
        var stream = await Synth.SynthesizeTextToStreamAsync(chunks[pos]);
        if (my != token || !playing) return;
        Player.Source = MediaSource.CreateFromStream(stream, stream.ContentType);
        Player.Play();
        Render();
    }

    static void Play() { token++; playing = true; Player.Pause(); _ = Speak(token); Render(); }
    static void Pause() { token++; playing = false; Player.Pause(); Render(); }
    static void Stop() { Save(); token++; playing = false; Player.Pause(); title = null; Bar.Visibility = Visibility.Collapsed; }
    static void Jump(int d) { pos = Math.Clamp(pos + d, 0, Math.Max(0, chunks.Count - 1)); if (playing) Play(); else Render(); }

    static void Render()
    {
        if (title == null) return;
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        row.Children.Add(new TextBlock { Text = "🎧  " + (title.Length > 40 ? title[..40] + "…" : title), Foreground = Brushes.White, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) });
        row.Children.Add(new TextBlock { Text = chunks.Count > 0 ? $"{100 * pos / chunks.Count} %" : "", Foreground = Brushes.Gray, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 8, 0) });
        row.Children.Add(Btn("⏪", () => Jump(-3)));
        row.Children.Add(Btn(playing ? "⏸" : "▶", () => { if (playing) Pause(); else Play(); }, primary: true));
        row.Children.Add(Btn("⏩", () => Jump(3)));
        row.Children.Add(Btn($"×{rate}", () => { double[] s = { 0.8, 1, 1.25, 1.5, 1.75, 2 }; rate = s[(Array.IndexOf(s, rate) + 1) % s.Length]; if (playing) Play(); else Render(); }));
        row.Children.Add(Btn("✕", Stop));
        var col = new StackPanel();
        col.Children.Add(row);
        col.Children.Add(new TextBlock { Text = pos < chunks.Count ? chunks[pos] : "", Foreground = Brushes.Gray, FontSize = 12, TextWrapping = TextWrapping.Wrap, MaxWidth = 520, MaxHeight = 34, Margin = new Thickness(0, 4, 0, 2) });
        Bar.Child = col;
        Bar.Visibility = Visibility.Visible;
    }
}
