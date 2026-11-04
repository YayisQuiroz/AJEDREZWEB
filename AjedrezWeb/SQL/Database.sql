/* =====================================================================
   AJEDREZ ONLINE - Script de base de datos (SQL Server)
   Equivale a lo que crea Entity Framework con EnsureCreated().
   Puedes ejecutarlo tú (SSMS) o dejar que la app cree las tablas sola.
   ===================================================================== */

/* ---------- 1. BASE DE DATOS ----------
   Si tu hosting ya te dio una base de datos, OMITE este bloque
   y ejecuta solo desde la sección 2 dentro de tu base.            */
IF DB_ID('AjedrezDb') IS NULL
    CREATE DATABASE AjedrezDb;
GO
USE AjedrezDb;
GO

/* ---------- 2. TABLAS ---------- */

CREATE TABLE Users (
    Id            INT IDENTITY(1,1) NOT NULL,
    Username      NVARCHAR(30)  NOT NULL,
    PasswordHash  NVARCHAR(200) NOT NULL,          -- salt.hash (PBKDF2), nunca la contraseña real
    AuthToken     NVARCHAR(64)  NULL,              -- token de la sesión actual
    CreatedAt     DATETIME2     NOT NULL CONSTRAINT DF_Users_CreatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Users PRIMARY KEY (Id)
);
CREATE UNIQUE INDEX IX_Users_Username ON Users (Username);
GO

CREATE TABLE Games (
    Id           INT IDENTITY(1,1) NOT NULL,
    Code         NVARCHAR(5)   NOT NULL,           -- código para unirse
    WhiteUserId  INT           NOT NULL,           -- quien creó la partida
    BlackUserId  INT           NULL,               -- quien se unió (null mientras espera)
    Fen          NVARCHAR(100) NOT NULL
        CONSTRAINT DF_Games_Fen DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    Status       NVARCHAR(10)  NOT NULL CONSTRAINT DF_Games_Status DEFAULT 'waiting',
    Result       NVARCHAR(10)  NULL,
    EndReason    NVARCHAR(20)  NULL,               -- checkmate | draw | resign | timeout
    CreatedAt    DATETIME2     NOT NULL CONSTRAINT DF_Games_CreatedAt DEFAULT SYSUTCDATETIME(),
    -- Reloj de ajedrez (0 = sin límite)
    TimeControlSeconds INT     NOT NULL CONSTRAINT DF_Games_TimeControl DEFAULT 0,
    WhiteTimeMs  INT           NOT NULL CONSTRAINT DF_Games_WhiteTime DEFAULT 0,
    BlackTimeMs  INT           NOT NULL CONSTRAINT DF_Games_BlackTime DEFAULT 0,
    LastMoveAt   DATETIME2     NULL,
    CONSTRAINT PK_Games PRIMARY KEY (Id),
    CONSTRAINT FK_Games_WhiteUser FOREIGN KEY (WhiteUserId) REFERENCES Users (Id),
    CONSTRAINT FK_Games_BlackUser FOREIGN KEY (BlackUserId) REFERENCES Users (Id),
    CONSTRAINT CK_Games_Status CHECK (Status IN ('waiting', 'playing', 'finished')),
    CONSTRAINT CK_Games_Result CHECK (Result IS NULL OR Result IN ('1-0', '0-1', '1/2-1/2'))
);
CREATE UNIQUE INDEX IX_Games_Code ON Games (Code);
CREATE INDEX IX_Games_WhiteUserId ON Games (WhiteUserId);
CREATE INDEX IX_Games_BlackUserId ON Games (BlackUserId);
GO

CREATE TABLE Moves (
    Id         INT IDENTITY(1,1) NOT NULL,
    GameId     INT           NOT NULL,
    Number     INT           NOT NULL,             -- 1, 2, 3...
    [From]     NVARCHAR(2)   NOT NULL,             -- ej. e2
    [To]       NVARCHAR(2)   NOT NULL,             -- ej. e4
    Promotion  NVARCHAR(1)   NULL,                 -- q, r, b, n
    Fen        NVARCHAR(100) NOT NULL,             -- tablero después de la jugada
    PlayedAt   DATETIME2     NOT NULL CONSTRAINT DF_Moves_PlayedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_Moves PRIMARY KEY (Id),
    CONSTRAINT FK_Moves_Games FOREIGN KEY (GameId) REFERENCES Games (Id) ON DELETE CASCADE,
    CONSTRAINT UQ_Moves_Game_Number UNIQUE (GameId, Number)   -- no hay dos jugadas con el mismo número
);
GO


/* =====================================================================
   3. CONSULTAS ÚTILES (para demostrar en clase)
   ===================================================================== */

-- Historial de partidas con nombres de jugadores
SELECT g.Code, w.Username AS Blancas, b.Username AS Negras,
       g.Status, g.Result, g.EndReason, g.TimeControlSeconds / 60 AS Minutos, g.CreatedAt,
       (SELECT COUNT(*) FROM Moves m WHERE m.GameId = g.Id) AS Jugadas
FROM Games g
JOIN Users w      ON w.Id = g.WhiteUserId
LEFT JOIN Users b ON b.Id = g.BlackUserId
ORDER BY g.CreatedAt DESC;

-- Jugadas de una partida, en orden (repetición)
SELECT m.Number, m.[From], m.[To], m.Promotion, m.PlayedAt
FROM Moves m
JOIN Games g ON g.Id = m.GameId
WHERE g.Code = 'AAAAA'            -- cambia por un código real
ORDER BY m.Number;

-- Estadísticas por usuario (ganadas, perdidas, tablas)
SELECT u.Username,
       COUNT(g.Id) AS Jugadas,
       SUM(CASE WHEN (g.Result = '1-0' AND g.WhiteUserId = u.Id)
                  OR (g.Result = '0-1' AND g.BlackUserId = u.Id) THEN 1 ELSE 0 END) AS Ganadas,
       SUM(CASE WHEN g.Result = '1/2-1/2' THEN 1 ELSE 0 END) AS Tablas,
       SUM(CASE WHEN (g.Result = '0-1' AND g.WhiteUserId = u.Id)
                  OR (g.Result = '1-0' AND g.BlackUserId = u.Id) THEN 1 ELSE 0 END) AS Perdidas
FROM Users u
JOIN Games g ON g.Status = 'finished' AND (g.WhiteUserId = u.Id OR g.BlackUserId = u.Id)
GROUP BY u.Username
ORDER BY Ganadas DESC;

-- Partidas que siguen en curso
SELECT Code, Status, CreatedAt FROM Games WHERE Status <> 'finished';
