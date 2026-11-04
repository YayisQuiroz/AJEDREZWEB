using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    // Botón "Authorize" en Swagger para probar con el token del login
    c.AddSecurityDefinition("Token", new OpenApiSecurityScheme
    {
        Name = "X-Auth-Token",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.ApiKey,
        Description = "Token que devuelve /api/auth/login"
    });
    c.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        { new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Token" } }, new string[] { } }
    });
});
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseSqlServer(builder.Configuration.GetConnectionString("Default")));

var app = builder.Build();

// Crea la base de datos y las tablas si no existen (o usa SQL/Database.sql)
using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureCreated();
}

app.UseSwagger();
app.UseSwaggerUI();      // documentación de la API en /swagger
app.UseCors();
app.UseDefaultFiles();   // sirve wwwroot/index.html
app.UseStaticFiles();
app.MapControllers();
app.Run();
