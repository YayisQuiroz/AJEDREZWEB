using Microsoft.EntityFrameworkCore;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Game> Games => Set<Game>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(u => u.Username).IsUnique();
        b.Entity<Game>().HasIndex(g => g.Code).IsUnique();

        // Dos llaves foráneas a Users: sin cascada para evitar ciclos en SQL Server
        b.Entity<Game>().HasOne(g => g.WhiteUser).WithMany()
            .HasForeignKey(g => g.WhiteUserId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Game>().HasOne(g => g.BlackUser).WithMany()
            .HasForeignKey(g => g.BlackUserId).OnDelete(DeleteBehavior.Restrict);

    }
}

