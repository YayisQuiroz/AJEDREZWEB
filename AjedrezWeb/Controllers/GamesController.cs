using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

[ApiController]
[Route("api/games")]
public class GamesController : AppControllerBase
{
    public GamesController(AppDbContext db) : base(db) { }

    private Task<Game?> Find(string code) =>
        Db.Games.Include(g => g.WhiteUser).Include(g => g.BlackUser)
                .FirstOrDefaultAsync(g => g.Code == code.Trim().ToUpper());

    // ---------- Reloj ----------

    // Tiempo restante de cada jugador "ahora" (descuenta lo transcurrido al jugador en turno)
    private static (long white, long black) Clocks(Game g)
    {
        long w = g.WhiteTimeMs, b = g.BlackTimeMs;
        if (g.TimeControlSeconds > 0 && g.Status == "playing" && g.LastMoveAt != null)
        {
            var elapsed = (long)Math.Max(0, (DateTime.UtcNow - g.LastMoveAt.Value).TotalMilliseconds);
            if (g.MoveCount % 2 == 0) w = Math.Max(0, w - elapsed);
            else b = Math.Max(0, b - elapsed);
        }
        return (w, b);
    }

    // Si al jugador en turno se le acabó el tiempo, termina la partida. Devuelve true si cambió algo.
    private static bool CheckTimeout(Game g)
    {
        if (g.TimeControlSeconds <= 0 || g.Status != "playing" || g.LastMoveAt == null) return false;

        var (w, b) = Clocks(g);
        var whiteTurn = g.MoveCount % 2 == 0;
        if ((whiteTurn ? w : b) > 0) return false;

        if (whiteTurn) g.WhiteTimeMs = 0; else g.BlackTimeMs = 0;
        g.Status = "finished";
        g.Result = whiteTurn ? "0-1" : "1-0";
        g.EndReason = "timeout";
        return true;
    }

    private static object ToState(Game g)
    {
        var (w, b) = Clocks(g);
        return new
        {
            code = g.Code,
            status = g.Status,
            fen = g.Fen,
            result = g.Result,
            endReason = g.EndReason,
            whiteName = g.WhiteUser.Username,
            blackName = g.BlackUser?.Username,
            turn = g.MoveCount % 2 == 0 ? "white" : "black",
            timeControl = g.TimeControlSeconds,
            whiteTimeMs = w,
            blackTimeMs = b,
            moves = MoveCodec.Decode(g.MoveList)          // el texto guardado se reinterpreta aquí
        };
    }

    // ---------- Endpoints ----------

    // Historial (?mine=true → solo las partidas del usuario autenticado)
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] bool mine = false)
    {
        var q = Db.Games.AsQueryable();
        if (mine)
        {
            var user = await CurrentUser();
            if (user == null) return NoAuth();
            q = q.Where(g => g.WhiteUserId == user.Id || g.BlackUserId == user.Id);
        }

        return Ok(await q.OrderByDescending(g => g.CreatedAt).Take(50)
            .Select(g => new
            {
                g.Code,
                g.Status,
                g.Result,
                g.EndReason,
                g.CreatedAt,
                White = g.WhiteUser.Username,
                Black = g.BlackUser != null ? g.BlackUser.Username : null,
                Minutes = g.TimeControlSeconds / 60,
                MoveCount = g.MoveCount
            }).ToListAsync());
    }

    // Crear partida (el creador juega con blancas). Minutes = 0 → sin límite de tiempo
    [HttpPost]
    public async Task<IActionResult> Create(CreateRequest? req)
    {
        var user = await CurrentUser();
        if (user == null) return NoAuth();

        var minutes = req?.Minutes ?? 10;
        if (minutes < 0 || minutes > 60) minutes = 10;

        string code;
        do { code = Guid.NewGuid().ToString("N")[..5].ToUpper(); }
        while (await Db.Games.AnyAsync(g => g.Code == code));

        Db.Games.Add(new Game
        {
            Code = code,
            WhiteUserId = user.Id,
            TimeControlSeconds = minutes * 60,
            WhiteTimeMs = minutes * 60 * 1000,
            BlackTimeMs = minutes * 60 * 1000
        });
        await Db.SaveChangesAsync();
        return Ok(new { code });
    }

    // Unirse con código (juega con negras). Aquí empieza a correr el reloj de las blancas
    [HttpPost("{code}/join")]
    public async Task<IActionResult> Join(string code)
    {
        var user = await CurrentUser();
        if (user == null) return NoAuth();

        var game = await Find(code);
        if (game == null) return NotFound(new { error = "Ese código no existe." });
        if (game.BlackUserId == user.Id) return Ok(ToState(game));   // ya estaba unido
        if (game.WhiteUserId == user.Id) return BadRequest(new { error = "No puedes jugar contra ti mismo." });
        if (game.BlackUserId != null) return Conflict(new { error = "La partida ya está llena." });

        game.BlackUserId = user.Id;
        game.BlackUser = user;
        game.Status = "playing";
        game.LastMoveAt = DateTime.UtcNow;
        await Db.SaveChangesAsync();
        return Ok(ToState(game));
    }

    // Estado de la partida (público: también sirve para repeticiones)
    [HttpGet("{code}")]
    public async Task<IActionResult> Get(string code)
    {
        var game = await Find(code);
        if (game == null) return NotFound(new { error = "Ese código no existe." });

        if (CheckTimeout(game))
        {
            try { await Db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException)      // otro jugador ya lo guardó: releer
            {
                Db.ChangeTracker.Clear();
                game = (await Find(code))!;
            }
        }
        return Ok(ToState(game));
    }

    // Hacer una jugada
    [HttpPost("{code}/moves")]
    public async Task<IActionResult> MakeMove(string code, MoveRequest req)
    {
        var user = await CurrentUser();
        if (user == null) return NoAuth();

        if (!MoveCodec.IsValid(req.From, req.To, req.Promotion))
            return BadRequest(new { error = "Jugada con formato inválido." });

        var game = await Find(code);
        if (game == null) return NotFound(new { error = "Ese código no existe." });

        if (CheckTimeout(game))
        {
            await Db.SaveChangesAsync();
            return BadRequest(new { error = "Se acabó el tiempo." });
        }
        if (game.Status != "playing") return BadRequest(new { error = "La partida no está en curso." });

        var whiteTurn = game.MoveCount % 2 == 0;
        var expectedUserId = whiteTurn ? game.WhiteUserId : game.BlackUserId;
        if (user.Id != expectedUserId) return StatusCode(403, new { error = "No es tu turno." });

        // Descontar el tiempo usado al jugador que mueve
        var now = DateTime.UtcNow;
        if (game.TimeControlSeconds > 0 && game.LastMoveAt != null)
        {
            var elapsed = (int)Math.Min(int.MaxValue, (now - game.LastMoveAt.Value).TotalMilliseconds);
            if (whiteTurn) game.WhiteTimeMs = Math.Max(0, game.WhiteTimeMs - elapsed);
            else game.BlackTimeMs = Math.Max(0, game.BlackTimeMs - elapsed);
        }
        game.LastMoveAt = now;

        // Una sola fila: se agrega la jugada al texto de la partida
        game.MoveList = MoveCodec.Append(game.MoveList, req.From, req.To, req.Promotion);
        game.MoveCount++;
        game.Fen = req.Fen;

        if (!string.IsNullOrEmpty(req.Result))
        {
            game.Result = req.Result;
            game.Status = "finished";
            game.EndReason = req.Result == "1/2-1/2" ? "draw" : "checkmate";
        }

        try { await Db.SaveChangesAsync(); }
        catch (DbUpdateException) { return Conflict(new { error = "La jugada ya fue registrada." }); }

        return Ok(ToState(game));
    }

    // Rendirse
    [HttpPost("{code}/resign")]
    public async Task<IActionResult> Resign(string code)
    {
        var user = await CurrentUser();
        if (user == null) return NoAuth();

        var game = await Find(code);
        if (game == null) return NotFound(new { error = "Ese código no existe." });
        if (game.Status != "playing") return BadRequest(new { error = "La partida no está en curso." });

        if (user.Id == game.WhiteUserId) game.Result = "0-1";
        else if (user.Id == game.BlackUserId) game.Result = "1-0";
        else return StatusCode(403, new { error = "No participas en esta partida." });

        game.Status = "finished";
        game.EndReason = "resign";
        await Db.SaveChangesAsync();
        return Ok(ToState(game));
    }
}
