import express from "express";
import pg from "pg";
import bodyParser from "body-parser";
import fs from "fs";
import axios from "axios";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import env from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const port = 3000;
env.config();

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

function formatData(data) {
  if (!data || data.length === 0) {
    console.error("formatData received empty data:", data);
    return [];
  }

  if (data[0]?.description || data[0]?.review || data[0]?.note) {
    data.forEach((item) => {
      if (item.description) {
        item.description = item.description.replace(/<br>/g, "");
        if (item.description.includes("\n")) {
          item.description = item.description.split("\n").join("<br>");
        }
      }

      if (item.review) {
        item.review = item.review.replace(/<br>/g, "");
        if (item.review.includes("\n")) {
          item.review = item.review.split("\n").join("<br>");
        }
      }

      if (item.note) {
        item.note = item.note.replace(/<br>/g, "");
        if (item.note.includes("\n")) {
          item.note = item.note.split("\n").join("<br>");
        }
      }
    });
  }

  return data;
}

app.get("/", async (req, res) => {
  const currentSortOption = req.query.sort;
  let result = null;

  try {
    if (currentSortOption === undefined || currentSortOption === "title") {
      result = await db.query("SELECT * FROM books ORDER BY title ASC");
    } else if (currentSortOption === "date") {
      result = await db.query("SELECT * FROM books ORDER BY date_read DESC");
    } else if (currentSortOption === "rating") {
      result = await db.query("SELECT * FROM books ORDER BY rating DESC");
    }

    const formattedDetails = formatData(result.rows);

    res.render("index.ejs", {
      data: formattedDetails,
      sortOption: currentSortOption,
    });
  } catch (error) {
    console.log(error);
  }
});

app.get("/new-entry", (req, res) => {
  res.render("new.ejs");
});

app.post("/new-entry/add", async (req, res) => {
  const isbn = req.body.isbn;
  const fileName = `${isbn}.jpg`;

  const imageSavePath = path.join(
    __dirname,
    "public",
    "assets",
    "covers",
    fileName
  );
  const imagePath = `assets/covers/${fileName}`;
  const timeStamp = new Date();

  try {
    const result = await axios.get(
      `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
      {
        responseType: "stream",
      }
    );

    const fileStream = fs.createWriteStream(imageSavePath);
    result.data.pipe(fileStream);

    fileStream.on("finish", async () => {
      console.log(`Image saved: ${fileName}`);
      try {
        await db.query(
          "INSERT INTO books (isbn, title, author, description, review, rating, image_path, date_read) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [
            req.body.isbn,
            req.body.title,
            req.body.author,
            req.body.description,
            req.body.review,
            req.body.rating,
            imagePath,
            timeStamp,
          ]
        );
        res.redirect("/");
      } catch (dbError) {
        console.error("Error inserting into DB:", dbError);
        res.status(500).send("Database error");
      }
    });

    fileStream.on("error", (err) => {
      console.error("Error writing file:", err);
      res.status(500).send("File writing error");
    });
  } catch (error) {
    console.error("Error fetching image:", error);
    res.status(500).send("Image fetch error");
  }
});

app.post("/books/:bookId/delete", async (req, res) => {
  const deleteBookId = req.params.bookId;
  try {
    await db.query("DELETE FROM notes WHERE book_id=$1", [deleteBookId]);

    await db.query("DELETE FROM books WHERE id=$1", [deleteBookId]);

    res.redirect("/");
  } catch (error) {
    console.log(error);
  }
});

app.get("/notes/:bookId", async (req, res) => {
  const bookid = req.params.bookId;

  try {
    const result = await db.query(
      "SELECT notes.id, notes.book_id, title, author, image_path, date_read, notes.note FROM books LEFT JOIN notes ON books.id = notes.book_id WHERE books.id = $1 ORDER BY notes.id DESC",
      [bookid]
    );

    const formattedNotes = formatData(result.rows);

    res.render("notes.ejs", { data: formattedNotes, bookId: bookid });
  } catch (error) {
    console.error("Error fetching notes:", error);
    res.status(500).send("Server error while fetching notes.");
  }
});

app.post("/notes/:bookId/add", async (req, res) => {
  const bookid = req.params.bookId;
  const note = req.body.newNote;

  try {
    await db.query("INSERT INTO notes (note, book_id) VALUES ($1, $2)", [
      note,
      bookid,
    ]);

    res.redirect(`/notes/${bookid}`);
  } catch (error) {
    console.log(error);
  }
});

app.post("/notes/:noteId/delete", async (req,res)=>{
  const bookid= req.body.bookId;
  const noteId = req.params.noteId;
  try {
    await db.query("DELETE FROM notes WHERE id=$1",[noteId]);
    res.redirect(`/notes/${bookid}`);
  } catch (error) {
    console.log(error);
  }
})

app.post("/notes/:noteId/update" , async (req,res)=>{
  const bookid= req.body.bookId;
  const noteId = req.params.noteId;
  const newNotes = req.body.noteToUpdate;

  try {
    await db.query("UPDATE notes SET note = ($1) WHERE id=$2", [newNotes, noteId]);
    res.redirect(`/notes/${bookid}`);
  } catch (error) {
    console.log(error);
  }
})

app.post("/reviews/:bookId/update", async (req,res)=>{
  const bookid = req.params.bookId;
  const updatedReview = req.body.reviewToUpdate;

  try {
    await db.query("UPDATE books SET review= ($1) WHERE id=$2", [updatedReview, bookid]);
    res.redirect("/");
  } catch (error) {
    console.log(error);
  }
})

app.listen(port, () => {
  console.log(`server is running at ${port}`);
});
