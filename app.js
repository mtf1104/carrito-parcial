Const express = require(‘express’);
Const mysql = require(‘mysql2’);
Const session = require(‘express-session’);
Const path = require(‘path’);
Const PDFDocument = require(‘pdfkit’);

Const app = express();

// --- 1. CONFIGURACIÓN ---
App.set(‘view engine’, ‘ejs’);
App.use(express.urlencoded({ extended: true }));
App.use(express.static(‘public’));

// Configuración de la sesión
App.use(session({
    Secret: ‘mi_secreto_super_seguro’,
    Resave: false,
    saveUninitialized: true,
    cookie: { secure: false } 
}));

// --- ¡AQUÍ ESTABA EL ERROR! FALTABA ESTE BLOQUE ---
// Middleware Global: Esto asegura que el carrito SIEMPRE exista
App.use((req, res, next) => {
    // 1. Si no existe el carrito, lo creamos vacío
    If (¡req.session.cart) {
        Req.session.cart = [];
    }

    // 2. Pasamos el usuario y el carrito a TODAS las vistas EJS
    Res.locals.cart = req.session.cart;
    Res.locals.user = req.session.user || null;

    // 3. Calculamos el total automáticamente
    Res.locals.cartTotal = req.session.cart.reduce((total, item) => {
        Return total + (item.price * item.quantity);
    }, 0);

    // 4. Continuamos
    Next();
});
// ----------------------------------------------------

// --- 2. BASE DE DATOS (TiDB Cloud) ---
Const db = mysql.createConnection({
    Host: ‘gateway01.us-east-1.prod.aws.tidbcloud.com’,
    Port: 4000,
    User: ‘3TfW3piDLzUBEx7.root’,
    Password: ‘qnYoAgJQEivo7wcn’,
    Database: ‘carrito_compras’,
    Ssl: { rejectUnauthorized: true }
});

Db.connect((err) => {
    If (err) {
        Console.error(‘Error conectando a la base de datos:’, err);
        Return;
    }
    Console.log(‘¡Conectado a TiDB Cloud exitosamente!’);
});

// --- 3. RUTAS ---

// INICIO – Ver Productos
App.get(‘/’, (req, res) => {
    Db.query(‘SELECT * FROM products’, (err, results) => {
        If (err) throw err;
        // Ya no necesitamos pasar {products: results, cart: …} 
        // porque el middleware de arriba ya se encarga del carrito.
        Res.render(‘index’, { products: results });
    });
});

// AUTH – Login y Registro
App.get(‘/login’, (req, res) => res.render(‘login’, { message: null }));

App.post(‘/register’, (req, res) => {
    Const { name, email, password } = req.body;
    Db.query(‘INSERT INTO users SET ¿’, { name, email, password }, (err) => {
        If (err) return res.render(‘login’, { message: ‘Error al registrar (quizá el correo ya existe)’ });
        Res.render(‘login’, { message: ‘Registro exitoso, por favor inicia sesión’ });
    });
});

App.post(‘/login’, (req, res) => {
    Const { email, password } = req.body;
    Db.query(‘SELECT * FROM users WHERE email = ¿ AND password = ¿’, [email, password], (err, results) => {
        If (results.length > 0) {
            Req.session.user = results[0];
            Res.redirect(‘/’);
        } else {
            Res.render(‘login’, { message: ‘Credenciales incorrectas’ });
        }
    });
});

App.get(‘/logout’, (req, res) => {
    Req.session.destroy();
    Res.redirect(‘/’);
});

// CARRITO – Lógica
App.post(‘/add-to-cart’, (req, res) => {
    Const { id, name, price, image } = req.body;
    Const quantity = parseInt(req.body.quantity);

    // El middleware ya creó el array, así que esto es seguro
    Const existingItem = req.session.cart.find(item => item.id == id);
    If (existingItem) {
        existingItem.quantity += quantity;
    } else {
        Req.session.cart.push({ id, name, price: parseFloat(price), image, quantity });
    }
    Res.redirect(‘/’);
});

App.get(‘/cart’, (req, res) => {
    Res.render(‘cart’);
});

App.post(‘/update-cart’, (req, res) => {
    Const { id, action } = req.body;
    Const cart = req.session.cart;
    Const itemIndex = cart.findIndex(item => item.id == id);

    If (itemIndex > -1) {
        If (action === ‘increase’) cart[itemIndex].quantity++;
        If (action === ‘decrease’) {
            Cart[itemIndex].quantity--;
            If (cart[itemIndex].quantity <= 0) cart.splice(itemIndex, 1);
        }
        If (action === ‘remove’) cart.splice(itemIndex, 1);
    }
    Res.redirect(‘/cart’);
});

// CHECKOUT – Realizar Compra
App.post(‘/checkout’, (req, res) => {
    If (¡req.session.user) return res.redirect(‘/login’);
    If (req.session.cart.length === 0) return res.redirect(‘/’);

    Const userId = req.session.user.id;
    Const total = req.session.cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);

    // 1. Guardar Orden
    Db.query(‘INSERT INTO orders (user_id, total) VALUES (¿, ¿)’, [userId, total], (err, result) => {
        If (err) throw err;
        Const orderId = result.insertId;

        // 2. Guardar Detalles
        Const cartItems = req.session.cart.map(item => [orderId, item.id, item.quantity, item.price]);
        Db.query(‘INSERT INTO order_details (order_id, product_id, quantity, price) VALUES ¿’, [cartItems], (err) => {
            If (err) throw err;
            Req.session.cart = []; // Vaciar carrito
            Res.redirect(‘/history’); 
        });
    });
});

// HISTORIAL
App.get(‘/history’, (req, res) => {
    If (¡req.session.user) return res.redirect(‘/login’);
    Const sql = ‘SELECT * FROM orders WHERE user_id = ¿ ORDER BY date DESC’;
    Db.query(sql, [req.session.user.id], (err, orders) => {
        Res.render(‘history’, { orders });
    });
});

// GENERAR PDF
App.get(‘/invoice/:id’, (req, res) => {
    If (¡req.session.user) return res.redirect(‘/login’);
    Const orderId = req.params.id;
    Const sqlOrder = ‘SELECT * FROM orders WHERE id = ¿ AND user_id = ¿’;
    Const sqlDetails = `SELECT od.*, p.name FROM order_details od JOIN products p ON od.product_id = p.id WHERE od.order_id = ¿`;

    Db.query(sqlOrder, [orderId, req.session.user.id], (err, orderResult) => {
        If (orderResult.length === 0) return res.send(“Orden no encontrada”);
        Db.query(sqlDetails, [orderId], (err, detailsResult) => {
            Const doc = new PDFDocument();
            Const filename = `Ticket_Orden_${orderId}.pdf`;
            Res.setHeader(‘Content-disposition’, ‘attachment; filename=”’ + filename + ‘”’);
            Res.setHeader(‘Content-type’, ‘application/pdf’);
            Doc.pipe(res);
            Doc.fontSize(25).text(‘TechZone – Comprobante’, { align: ‘center’ });
            Doc.moveDown();
            Doc.fontSize(12).text(`Cliente: ${req.session.user.name}`);
            Doc.text(`Total: $${orderResult[0].total}`);
            Doc.moveDown();
            detailsResult.forEach(item => {
                doc.text(`${item.quantity} x ${item.name} - $${item.price}`);
            });
            Doc.end();
        });
    });
});

// PUERTO (Importante para Render)
Const PORT = process.env.PORT || 3000;
App.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
