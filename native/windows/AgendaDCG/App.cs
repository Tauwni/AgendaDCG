using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using Microsoft.Win32;
using Velopack;

namespace AgendaDCG;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        VelopackApp.Build().Run();
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        Theme.Install(app);
        app.Exit += (_, _) => Updater.ApplyOnExit();
        app.DispatcherUnhandledException += (_, e) =>
        {
            MessageBox.Show(e.Exception.Message, "Agenda DCG", MessageBoxButton.OK, MessageBoxImage.Warning);
            e.Handled = true;
        };
        app.Run(new MainWindow());
    }
}

/// Couleurs et styles (clair / sombre selon Windows).
public static class Theme
{
    public static readonly bool Dark = IsDark();
    static bool IsDark()
    {
        try { return Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")?.GetValue("AppsUseLightTheme") is int v && v == 0; }
        catch { return false; }
    }
    static SolidColorBrush B(string hex) { var b = (SolidColorBrush)new BrushConverter().ConvertFromString(hex)!; b.Freeze(); return b; }
    public static readonly Brush Bg = B(Dark ? "#1C1C1E" : "#F5F5F7");
    public static readonly Brush Side = B(Dark ? "#161618" : "#EBEBF0");
    public static readonly Brush Card = B(Dark ? "#2C2C2E" : "#FFFFFF");
    public static readonly Brush Line = B(Dark ? "#3A3A3C" : "#E5E5EA");
    public static readonly Brush Text = B(Dark ? "#F5F5F7" : "#1D1D1F");
    public static readonly Brush Text2 = B(Dark ? "#A1A1A6" : "#6E6E73");
    public static readonly Brush Accent = B("#FF3B30");
    public static readonly Brush Blue = B(Dark ? "#0A84FF" : "#007AFF");
    public static readonly Brush Green = B("#34C759");
    public static readonly Brush Orange = B("#FF9500");
    public static readonly Brush Soft = B(Dark ? "#3A3A3C" : "#E9E9EE");
    public static readonly Brush AccentSoft = B(Dark ? "#3A1E1C" : "#FFE9E7");
    public static readonly Brush Selected = B(Dark ? "#3A3A3C" : "#DCDCE2");
    public static Brush Of(string? color, byte alpha = 255)
    {
        var c = (Color)ColorConverter.ConvertFromString(Data.ColorHex(color));
        var b = new SolidColorBrush(Color.FromArgb(alpha, c.R, c.G, c.B)); b.Freeze(); return b;
    }
    /// Styles globaux : champs arrondis, focus rouge, cases à cocher et menus aux couleurs de l'app.
    public static void Install(Application app)
    {
        var r = app.Resources;
        r[SystemColors.HighlightBrushKey] = Accent;
        r[SystemColors.ControlTextBrushKey] = Text;
        r[typeof(TextBox)] = Field(typeof(TextBox));
        r[typeof(PasswordBox)] = Field(typeof(PasswordBox));
        var check = new Style(typeof(CheckBox));
        check.Setters.Add(new Setter(Control.ForegroundProperty, Text));
        r[typeof(CheckBox)] = check;
        var tip = new Style(typeof(ToolTip));
        tip.Setters.Add(new Setter(Control.BackgroundProperty, Card));
        tip.Setters.Add(new Setter(Control.ForegroundProperty, Text));
        tip.Setters.Add(new Setter(Control.BorderBrushProperty, Line));
        r[typeof(ToolTip)] = tip;
        var scroll = new Style(typeof(ScrollBar));
        scroll.Setters.Add(new Setter(FrameworkElement.WidthProperty, 8.0));
        scroll.Setters.Add(new Setter(UIElement.OpacityProperty, 0.6));
        r[typeof(ScrollBar)] = scroll;
    }

    static Style Field(Type type)
    {
        var tpl = new ControlTemplate(type);
        var border = new FrameworkElementFactory(typeof(Border), "bd");
        border.SetValue(Border.CornerRadiusProperty, new CornerRadius(9));
        border.SetValue(Border.BackgroundProperty, Card);
        border.SetValue(Border.BorderBrushProperty, Line);
        border.SetValue(Border.BorderThicknessProperty, new Thickness(1.5));
        var host = new FrameworkElementFactory(typeof(ScrollViewer), "PART_ContentHost");
        host.SetValue(FrameworkElement.MarginProperty, new Thickness(8, 6, 8, 6));
        host.SetValue(ScrollViewer.VerticalScrollBarVisibilityProperty, ScrollBarVisibility.Hidden);
        border.AppendChild(host);
        tpl.VisualTree = border;
        var focus = new Trigger { Property = UIElement.IsKeyboardFocusWithinProperty, Value = true };
        focus.Setters.Add(new Setter(Border.BorderBrushProperty, Accent, "bd"));
        var off = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
        off.Setters.Add(new Setter(UIElement.OpacityProperty, 0.55));
        tpl.Triggers.Add(focus);
        tpl.Triggers.Add(off);
        var st = new Style(type);
        st.Setters.Add(new Setter(Control.TemplateProperty, tpl));
        st.Setters.Add(new Setter(Control.ForegroundProperty, Text));
        st.Setters.Add(new Setter(Control.FontSizeProperty, 14.0));
        st.Setters.Add(new Setter(Control.FontFamilyProperty, Font));
        st.Setters.Add(new Setter(type == typeof(TextBox) ? TextBoxBase.CaretBrushProperty : PasswordBox.CaretBrushProperty, Text));
        st.Setters.Add(new Setter(type == typeof(TextBox) ? TextBoxBase.SelectionBrushProperty : PasswordBox.SelectionBrushProperty, Accent));
        return st;
    }

    /// Barre de titre sombre et matière Mica (Windows 11).
    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
    public static void Chrome(Window w)
    {
        w.SourceInitialized += (_, _) =>
        {
            try
            {
                var h = new System.Windows.Interop.WindowInteropHelper(w).Handle;
                int dark = Dark ? 1 : 0; DwmSetWindowAttribute(h, 20, ref dark, 4);
                int round = 2; DwmSetWindowAttribute(h, 33, ref round, 4);
            }
            catch { }
        };
    }

    public static readonly FontFamily Font = new("Segoe UI Variable Text, Segoe UI");
    public static readonly FontFamily Icons = new("Segoe Fluent Icons, Segoe MDL2 Assets");
}
