using System.ComponentModel.DataAnnotations;

public class Game
{
    public int Id { get; set; }
    [MaxLength(5)] public string Code { get; set; } = "";

    public int WhiteUserId { get; set; }
    public User WhiteUser { get; set; } = null!;
    public int? BlackUserId { get; set; }
    public User? BlackUser { get; set; }

    [MaxLength(100)] public string Fen { get; set; } = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    [MaxLength(10)] public string Status { get; set; } = "waiting";   // waiting | playing | finished
    [MaxLength(10)] public string? Result { get; set; }               // 1-0 | 0-1 | 1/2-1/2
    [MaxLength(20)] public string? EndReason { get; set; }            // checkmate | draw | resign | timeout
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Todas las jugadas de la partida en UNA sola columna: "e2e4 e7e5 g1f3 ..." (ver MoveCodec)
    public string MoveList { get; set; } = "";
    public int MoveCount { get; set; }          // cuántas jugadas lleva (define de quién es el turno)

    // Reloj de ajedrez (TimeControlSeconds = 0 → sin límite)
    public int TimeControlSeconds { get; set; }
    public int WhiteTimeMs { get; set; }
    public int BlackTimeMs { get; set; }
    public DateTime? LastMoveAt { get; set; }   // desde cuándo corre el reloj del jugador en turno

    // Evita que dos jugadas simultáneas se pisen al editar el mismo texto
    [Timestamp] public byte[]? RowVersion { get; set; }
}

public record AuthRequest(string Username, string Password);
public record CreateRequest(int Minutes);
public record MoveRequest(string From, string To, string? Promotion, string Fen, string? Result);
