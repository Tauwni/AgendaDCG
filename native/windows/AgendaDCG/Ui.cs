using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace AgendaDCG;

/// Petites fabriques pour construire l'interface en code.
public static class Ui
{
    public static TextBlock T(string text, double size = 14, FontWeight? weight = null, Brush? color = null) => new()
    {
        Text = text, FontSize = size, FontWeight = weight ?? FontWeights.Normal, Foreground = color ?? Theme.Text,
        TextTrimming = TextTrimming.CharacterEllipsis, FontFamily = Theme.Font,
    };

    public static TextBlock Icon(string glyph, double size = 16, Brush? color = null) => new()
    {
        Text = glyph, FontFamily = Theme.Icons, FontSize = size, Foreground = color ?? Theme.Text, VerticalAlignment = VerticalAlignment.Center,
    };

    public static Border Card(UIElement child, double pad = 14) => new()
    {
        Child = child, Background = Theme.Card, CornerRadius = new CornerRadius(10), Padding = new Thickness(pad),
        BorderBrush = Theme.Line, BorderThickness = new Thickness(1),
    };

    public static StackPanel V(double gap, params UIElement[] items)
    {
        var p = new StackPanel();
        foreach (var i in items) { if (i is FrameworkElement f && p.Children.Count > 0) f.Margin = new Thickness(f.Margin.Left, f.Margin.Top + gap, f.Margin.Right, f.Margin.Bottom); p.Children.Add(i); }
        return p;
    }

    public static StackPanel H(double gap, params UIElement[] items)
    {
        var p = new StackPanel { Orientation = Orientation.Horizontal };
        foreach (var i in items) { if (i is FrameworkElement f && p.Children.Count > 0) f.Margin = new Thickness(f.Margin.Left + gap, f.Margin.Top, f.Margin.Right, f.Margin.Bottom); p.Children.Add(i); }
        return p;
    }

    static Style? buttonStyle;
    static Style ButtonStyle()
    {
        if (buttonStyle != null) return buttonStyle;
        var tpl = new ControlTemplate(typeof(Button));
        var border = new FrameworkElementFactory(typeof(Border));
        border.SetBinding(Border.BackgroundProperty, new System.Windows.Data.Binding("Background") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
        border.SetBinding(Border.PaddingProperty, new System.Windows.Data.Binding("Padding") { RelativeSource = System.Windows.Data.RelativeSource.TemplatedParent });
        border.SetValue(Border.CornerRadiusProperty, new CornerRadius(7));
        var cp = new FrameworkElementFactory(typeof(ContentPresenter));
        cp.SetValue(ContentPresenter.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        cp.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        border.AppendChild(cp);
        tpl.VisualTree = border;
        var trigger = new Trigger { Property = UIElement.IsMouseOverProperty, Value = true };
        trigger.Setters.Add(new Setter(UIElement.OpacityProperty, 0.85));
        var disabled = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
        disabled.Setters.Add(new Setter(UIElement.OpacityProperty, 0.45));
        tpl.Triggers.Add(trigger);
        tpl.Triggers.Add(disabled);
        buttonStyle = new Style(typeof(Button));
        buttonStyle.Setters.Add(new Setter(Control.TemplateProperty, tpl));
        buttonStyle.Setters.Add(new Setter(FrameworkElement.CursorProperty, Cursors.Hand));
        return buttonStyle;
    }

    public static Button Btn(object content, Action onClick, bool primary = false, bool danger = false)
    {
        var b = new Button
        {
            Content = content is string s ? T(s, 13, FontWeights.SemiBold, primary ? Brushes.White : danger ? Theme.Accent : Theme.Text) : content,
            Background = primary ? Theme.Blue : Theme.Line, Padding = new Thickness(14, 7, 14, 7), Style = ButtonStyle(),
        };
        b.Click += (_, _) => onClick();
        return b;
    }

    public static Button IconBtn(string glyph, Action onClick, string tip)
    {
        var b = new Button { Content = Icon(glyph, 14), Background = Brushes.Transparent, Padding = new Thickness(8), Style = ButtonStyle(), ToolTip = tip };
        b.Click += (_, _) => onClick();
        return b;
    }

    public static Border Clickable(UIElement child, Action onClick)
    {
        var b = new Border { Child = child, Background = Brushes.Transparent, Cursor = Cursors.Hand };
        b.MouseLeftButtonUp += (_, e) => { onClick(); e.Handled = true; };
        return b;
    }

    public static Rectangle Bar(Brush color, double width = 4) => new() { Width = width, Fill = color, RadiusX = 2, RadiusY = 2, Margin = new Thickness(0, 0, 10, 0) };

    public static TextBox Input(string text = "", string? placeholder = null) => new()
    {
        Text = text, FontSize = 14, Padding = new Thickness(6, 5, 6, 5), Background = Theme.Card, Foreground = Theme.Text,
        BorderBrush = Theme.Line, CaretBrush = Theme.Text, ToolTip = placeholder,
    };

    public static ComboBox Combo(IEnumerable<(string Value, string Label)> items, string? selected)
    {
        var c = new ComboBox { FontSize = 14, Padding = new Thickness(6, 4, 6, 4) };
        foreach (var (v, l) in items) c.Items.Add(new ComboBoxItem { Content = l, Tag = v, IsSelected = v == selected });
        if (c.SelectedIndex < 0 && c.Items.Count > 0) c.SelectedIndex = 0;
        return c;
    }
    public static string Value(this ComboBox c) => (c.SelectedItem as ComboBoxItem)?.Tag as string ?? "";

    public static FrameworkElement Field(string label, UIElement input)
    {
        var g = new Grid { Margin = new Thickness(0, 4, 0, 4) };
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(185) });
        g.ColumnDefinitions.Add(new ColumnDefinition());
        var t = T(label, 13, null, Theme.Text2); t.VerticalAlignment = VerticalAlignment.Center;
        g.Children.Add(t);
        Grid.SetColumn(input, 1);
        g.Children.Add(input);
        return g;
    }

    public static double? Number(string s) => double.TryParse(s.Replace(',', '.'), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : null;

    public static void Toast(string msg) => MainWindow.Current?.ShowToast(msg);

    public static async Task<bool> Try(Func<Task> action)
    {
        try { await action(); return true; }
        catch (Exception e) { Toast(e.Message); return false; }
    }

    public static Window Dialog(string title, UIElement content, double width = 480)
    {
        var w = new Window
        {
            Title = title, Content = new ScrollViewer { Content = new Border { Padding = new Thickness(22), Child = content }, VerticalScrollBarVisibility = ScrollBarVisibility.Auto },
            Width = width, SizeToContent = SizeToContent.Height, MaxHeight = 820, Background = Theme.Bg, Owner = MainWindow.Current,
            WindowStartupLocation = WindowStartupLocation.CenterOwner, ResizeMode = ResizeMode.NoResize, ShowInTaskbar = false, FontFamily = Theme.Font,
        };
        w.KeyDown += (_, e) => { if (e.Key == Key.Escape) w.Close(); };
        return w;
    }

    public static bool Confirm(string text) => MessageBox.Show(text, "Agenda DCG", MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes;
}
