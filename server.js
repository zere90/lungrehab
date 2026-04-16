const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const { User, LessonProgress, TestResult } = require('./models');

const app = express();
const PORT = process.env.PORT || 3000;

// Важно для Render / прокси (иначе secure cookies могут не работать)
app.set('trust proxy', 1);

// ============ ПОДКЛЮЧЕНИЕ К MONGODB ============
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/lung-rehab';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB подключена успешно'))
  .catch(err => {
    console.error('❌ Ошибка подключения к MongoDB:', err);
    process.exit(1);
  });

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ============ СЕССИИ ============
app.use(session({
  secret: process.env.SESSION_SECRET || 'lung-rehab-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGODB_URI,
    touchAfter: 24 * 3600
  }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 часа
    secure: process.env.NODE_ENV === 'production', // HTTPS в продакшене
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    httpOnly: true
  }
}));

// ============ СТАТИКА + ГЛАВНАЯ СТРАНИЦА ============
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ ok: true, environment: process.env.NODE_ENV || 'development' });
});

// Middleware для проверки авторизации
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ error: 'Необходима авторизация' });
  }
}

// ============ РЕГИСТРАЦИЯ ============
app.post('/api/register', async (req, res) => {
  const { username, email, password, full_name } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Заполните все обязательные поля' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      email,
      password: hashedPassword,
      full_name
    });

    await user.save();

    // Инициализация прогресса для всех уроков
    const progressPromises = [];
    for (let i = 1; i <= 7; i++) {
      progressPromises.push(
        new LessonProgress({
          user_id: user._id,
          lesson_number: i
        }).save()
      );
    }
    await Promise.all(progressPromises);

    res.json({ success: true, message: 'Регистрация успешна' });
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    if (error.code === 11000) {
      res.status(400).json({ error: 'Пользователь с таким email или логином уже существует' });
    } else {
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  }
});

// ============ ВХОД ============
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    req.session.userId = user._id.toString();
    req.session.username = user.username;

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        full_name: user.full_name
      }
    });
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ============ ВЫХОД ============
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ============ ПОЛУЧИТЬ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ ============
app.get('/api/user', isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({
      id: user._id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      test_score: user.test_score,
      created_at: user.created_at
    });
  } catch (error) {
    console.error('Ошибка получения пользователя:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ============ ОТМЕТИТЬ УРОК КАК ПРОЙДЕННЫЙ ============
app.post('/api/lesson/complete', isAuthenticated, async (req, res) => {
  const { lesson_number } = req.body;

  try {
    await LessonProgress.updateOne(
      { user_id: req.session.userId, lesson_number },
      {
        completed: true,
        completed_at: new Date()
      }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления прогресса:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ============ ПОЛУЧИТЬ ПРОГРЕСС ПОЛЬЗОВАТЕЛЯ ============
app.get('/api/progress', isAuthenticated, async (req, res) => {
  try {
    const progress = await LessonProgress.find({ user_id: req.session.userId })
      .sort({ lesson_number: 1 })
      .select('lesson_number completed completed_at');

    res.json(progress);
  } catch (error) {
    console.error('Ошибка получения прогресса:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ============ СОХРАНИТЬ РЕЗУЛЬТАТ ТЕСТА ============
app.post('/api/test/submit', isAuthenticated, async (req, res) => {
  const { score, total_questions, answers } = req.body;
  
  // ИСПРАВЛЕНО: порог 5 из 7
  const passed = score >= 5;

  try {
    // Обновляем test_score в модели User
    await User.updateOne(
      { _id: req.session.userId },
      { test_score: score }
    );

    const testResult = new TestResult({
      user_id: req.session.userId,
      score,
      total_questions,
      answers: JSON.stringify(answers),
      passed
    });

    await testResult.save();

    res.json({ success: true, passed });
  } catch (error) {
    console.error('Ошибка сохранения теста:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ============ ПОЛУЧИТЬ РЕЗУЛЬТАТЫ ТЕСТОВ ============
app.get('/api/test/results', isAuthenticated, async (req, res) => {
  try {
    const results = await TestResult.find({ user_id: req.session.userId })
      .sort({ taken_at: -1 })
      .select('score total_questions passed taken_at');

    res.json({ results });
  } catch (error) {
    console.error('Ошибка получения результатов:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`📊 Окружение: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
