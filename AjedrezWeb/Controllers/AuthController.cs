using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

[ApiController]
[Route("api/auth")]
public class AuthController : AppControllerBase
{
    public AuthController(AppDbContext db) : base(db) { }

    [HttpPost("register")]
    public async Task<IActionResult> Register(AuthRequest req)
    {
        var name = (req.Username ?? "").Trim();
        if (name.Length < 3 || name.Length > 30)
            return BadRequest(new { error = "El usuario debe tener entre 3 y 30 caracteres." });
        if ((req.Password ?? "").Length < 6)
            return BadRequest(new { error = "La contraseña debe tener al menos 6 caracteres." });
        if (await Db.Users.AnyAsync(u => u.Username == name))
            return Conflict(new { error = "Ese usuario ya existe." });

        var user = new User
        {
            Username = name,
            PasswordHash = PasswordHelper.Hash(req.Password!),
            AuthToken = PasswordHelper.NewToken()
        };
        Db.Users.Add(user);
        await Db.SaveChangesAsync();
        return Ok(new { username = user.Username, token = user.AuthToken });
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login(AuthRequest req)
    {
        var name = (req.Username ?? "").Trim();
        var user = await Db.Users.FirstOrDefaultAsync(u => u.Username == name);
        if (user == null || !PasswordHelper.Verify(req.Password ?? "", user.PasswordHash))
            return Unauthorized(new { error = "Usuario o contraseña incorrectos." });

        user.AuthToken = PasswordHelper.NewToken();
        await Db.SaveChangesAsync();
        return Ok(new { username = user.Username, token = user.AuthToken });
    }

    // Perfil + estadísticas del usuario autenticado
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var user = await CurrentUser();
        if (user == null) return NoAuth();

        var finished = await Db.Games
            .Where(g => g.Status == "finished" && (g.WhiteUserId == user.Id || g.BlackUserId == user.Id))
            .Select(g => new { g.Result, g.WhiteUserId })
            .ToListAsync();

        var wins = finished.Count(g => (g.Result == "1-0" && g.WhiteUserId == user.Id)
                                    || (g.Result == "0-1" && g.WhiteUserId != user.Id));
        var draws = finished.Count(g => g.Result == "1/2-1/2");

        return Ok(new
        {
            username = user.Username,
            played = finished.Count,
            wins,
            losses = finished.Count - wins - draws,
            draws
        });
    }
}
