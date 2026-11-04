using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

public abstract class AppControllerBase : ControllerBase
{
    protected readonly AppDbContext Db;
    protected AppControllerBase(AppDbContext db) => Db = db;

    // Lee el header X-Auth-Token y busca al usuario
    protected async Task<User?> CurrentUser()
    {
        var token = Request.Headers["X-Auth-Token"].ToString();
        if (string.IsNullOrEmpty(token)) return null;
        return await Db.Users.FirstOrDefaultAsync(u => u.AuthToken == token);
    }

    protected IActionResult NoAuth() => Unauthorized(new { error = "Inicia sesión primero." });
}
