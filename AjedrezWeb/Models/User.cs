using System.ComponentModel.DataAnnotations;

public class User
{
    public int Id { get; set; }
    [MaxLength(30)] public string Username { get; set; } = "";
    [MaxLength(200)] public string PasswordHash { get; set; } = "";
    [MaxLength(64)] public string? AuthToken { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
