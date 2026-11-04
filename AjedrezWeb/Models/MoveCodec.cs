using System.Text.RegularExpressions;

// Una jugada ya "reinterpretada" (lo que el navegador recibe en el arreglo "moves")
public record MoveItem(int Number, string From, string To, string? Promotion);

/// <summary>
/// Guarda TODAS las jugadas de una partida en un solo texto y las vuelve a interpretar.
/// Formato: jugadas separadas por espacio, cada una = casilla origen + casilla destino (+ pieza si corona)
///   "e2e4 e7e5 g1f3 b8c6 ... e7e8q"
/// El número de jugada es la posición en el texto (1ª, 2ª, 3ª...).
/// </summary>
public static class MoveCodec
{
    private static readonly Regex Square = new(@"^[a-h][1-8]\z");
    private static readonly Regex Promo = new(@"^[qrbn]\z");

    // Evita que entre basura (espacios, letras raras) al texto guardado
    public static bool IsValid(string? from, string? to, string? promotion) =>
        Square.IsMatch(from ?? "") && Square.IsMatch(to ?? "") &&
        (string.IsNullOrEmpty(promotion) || Promo.IsMatch(promotion));

    // CODIFICAR: agrega una jugada al final del texto
    public static string Append(string? list, string from, string to, string? promotion)
    {
        var token = from + to + (string.IsNullOrEmpty(promotion) ? "" : promotion);
        return string.IsNullOrEmpty(list) ? token : list + " " + token;
    }

    // DECODIFICAR: convierte el texto en la lista de jugadas
    public static List<MoveItem> Decode(string? list)
    {
        var result = new List<MoveItem>();
        if (string.IsNullOrWhiteSpace(list)) return result;

        var tokens = list.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i < tokens.Length; i++)
        {
            var t = tokens[i];
            if (t.Length < 4) continue;
            result.Add(new MoveItem(
                i + 1,
                t.Substring(0, 2),
                t.Substring(2, 2),
                t.Length > 4 ? t.Substring(4, 1) : null));
        }
        return result;
    }
}
