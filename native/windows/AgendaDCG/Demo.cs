namespace AgendaDCG;

/// Données fictives pour les captures d'écran du build (AGENDA_DEMO=1), sans réseau.
static class Demo
{
    public static void Load()
    {
        string D(int n) => Data.Iso(DateTime.Today.AddDays(n));
        var mon = -(((int)DateTime.Today.DayOfWeek + 6) % 7);
        const string UE10 = "UE10 · Comptabilité approfondie", UE4 = "UE4 · Droit fiscal", UE6 = "UE6 · Finance d'entreprise", UE2 = "UE2 · Droit des sociétés";
        var s = Store.I;
        s.Schedule = new()
        {
            CompanyDays = new() { 1, 2, 3 },
            Classes = new()
            {
                new() { Day = 4, Start = "08:30", End = "12:30", Subject = UE2, Title = "Droit des sociétés", Color = "brown" },
                new() { Day = 4, Start = "13:30", End = "17:30", Subject = UE4, Title = "Droit fiscal", Color = "purple" },
                new() { Day = 5, Start = "08:30", End = "12:30", Subject = UE6, Title = "Finance d'entreprise", Color = "yellow" },
                new() { Day = 5, Start = "13:30", End = "17:30", Subject = UE10, Title = "Comptabilité approfondie", Color = "red" },
            },
        };
        s.Chapters = new()
        {
            new() { Id = "c1", Subject = UE10, Title = "Chapitre 6 – Les provisions pour risques et charges", Files = new() { ["cours"] = new() { Key = "k1", Name = "Fiche.pdf", Size = 812000 }, ["sujet"] = new() { Key = "k2", Name = "Sujet.pdf", Size = 240000 }, ["corrige"] = null, ["topexo"] = null } },
            new() { Id = "c2", Subject = UE10, Title = "Chapitre 9 – Les contrats à long terme", Files = new() { ["cours"] = new() { Key = "k3", Name = "Fiche.pdf", Size = 1500000 }, ["sujet"] = null, ["corrige"] = null, ["topexo"] = null } },
            new() { Id = "c3", Subject = UE4, Title = "Chapitres 1 à 6 – La TVA", Files = new() { ["cours"] = null, ["sujet"] = null, ["corrige"] = null, ["topexo"] = null } },
        };
        AgendaEvent E(string id, string kind, string title, string sub, int day, string time, string color) => new() { Id = id, Kind = kind, Title = title, Subject = sub, Date = D(day), Time = time, Color = color, CreatedBy = "Tony", UpdatedBy = "Tony" };
        s.Events = new()
        {
            E("1", "cours", "Cours de compta appro", UE10, mon, "09:00", "red"), E("2", "revision", "Réviser la TVA", UE4, 0, "", "purple"),
            E("3", "devoir", "Cas pratique provisions", UE10, 0, "18:00", "red"), E("4", "eval", "Contrôle contrats à long terme", UE10, 2, "10:00", "red"),
            E("5", "exercice", "Exercices SARL", UE2, 1, "", "brown"), E("6", "examen", "Examen blanc de finance", UE6, 4, "08:30", "yellow"),
            E("7", "devoir", "Dossier droit fiscal", UE4, 9, "", "purple"),
            E("8", "devoir", "Devoir finance ch. 5", UE6, (5 - (int)DateTime.Today.DayOfWeek + 7) % 7, "08:30", "yellow"),
        };
        Grade G(string sub, string t, int day, double v, string cat, double coef) => new() { Id = Guid.NewGuid().ToString(), Subject = sub, Title = t, Date = D(day), Value = v, Category = cat, Coef = coef };
        s.Profile = new()
        {
            Id = "tony", Name = "Tony", Done = new() { "3" },
            Prefs = new() { OnNew = true, Daily = true, Before = new() { 1, 2 } },
            Grades = new()
            {
                G(UE10, "Contrôle constitution", -50, 10.5, "controle", 2), G(UE10, "Devoir capital", -35, 13, "devoir", 1), G(UE10, "Contrôle provisions", -14, 13.5, "controle", 2), G(UE10, "Examen blanc", -5, 14.5, "examen", 3),
                G(UE4, "Contrôle TVA", -39, 11, "controle", 2), G(UE4, "Devoir territorialité", -21, 14, "devoir", 1),
                G(UE6, "Contrôle diagnostic", -42, 9, "controle", 2), G(UE6, "Contrôle CAF", -7, 13, "controle", 2),
            },
        };
    }
}
