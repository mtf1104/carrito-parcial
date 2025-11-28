const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const path = require('path');
const PDFDocument = require('pdfkit'); // Para generar el PDF

const app = express();

// --- 1. CONFIGURACIÓN ---
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configuración de la sesión (Memoria del carrito y usuario)
app.use(session({
    secret: 'mi_secreto_super_seguro',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // false para http localhost
}));

// --- 2. BASE DE DATOS (Conexión a TiDB Cloud) ---
const db = mysql.createConnection({
    host: 'gateway01.us-east-1.prod.aws.tidbcloud.com',
    port: 4000,
    user: '3TfW3piDLzUBEx7.root',
    password: 'qnYoAgJQEivo7wcn',
    database: 'carrito_compras',
    ssl: {
        rejectUnauthorized: true
    }
});

db.connect((err) => {
    if (err) {
        console.error('Error conectando a la base de datos:', err);
        return;
    }
    console.log('¡Conectado a TiDB Cloud exitosamente!');
});

// --- 3. RUTAS ---

// INICIO - Ver Productos
app.get('/', (req, res) => {
    db.query('SELECT * FROM products', (err, results) => {
        if (err) throw err;
        res.render('index', { products: results });
    });
});

// AUTH - Login y Registro
app.get('/login', (req, res) => res.render('login', { message: null }));

app.post('/register', (req, res) => {
    const { name, email, password } = req.body;
    db.query('INSERT INTO users SET ?', { name, email, password }, (err) => {
        if (err) return res.render('login', { message: 'Error al registrar (quizá el correo ya existe)' });
        res.render('login', { message: 'Registro exitoso, por favor inicia sesión' });
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    db.query('SELECT * FROM users WHERE email = ? AND password = ?', [email, password], (err, results) => {
        if (results.length > 0) {
            req.session.user = results[0];
            res.redirect('/');
        } else {
            res.render('login', { message: 'Credenciales incorrectas' });
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// CARRITO - Lógica
app.post('/add-to-cart', (req, res) => {
    const { id, name, price, image } = req.body;
    const quantity = parseInt(req.body.quantity); // Cantidad que viene del input

    if (!req.session.cart) req.session.cart = [];

    const existingItem = req.session.cart.find(item => item.id == id);
    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        req.session.cart.push({ id, name, price: parseFloat(price), image, quantity });
    }
    res.redirect('/');
});

app.get('/cart', (req, res) => {
    res.render('cart');
});

app.post('/update-cart', (req, res) => {
    const { id, action } = req.body;
    const cart = req.session.cart;
    const itemIndex = cart.findIndex(item => item.id == id);

    if (itemIndex > -1) {
        if (action === 'increase') cart[itemIndex].quantity++;
        if (action === 'decrease') {
            cart[itemIndex].quantity--;
            if (cart[itemIndex].quantity <= 0) cart.splice(itemIndex, 1);
        }
        if (action === 'remove') cart.splice(itemIndex, 1);
    }
    res.redirect('/cart');
});

// CHECKOUT - Realizar Compra
app.post('/checkout', (req, res) => {
    if (!req.session.user) return res.redirect('/login'); // Validar login
    if (req.session.cart.length === 0) return res.redirect('/');

    const userId = req.session.user.id;
    const total = req.session.cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);

    // 1. Guardar Orden
    db.query('INSERT INTO orders (user_id, total) VALUES (?, ?)', [userId, total], (err, result) => {
        if (err) throw err;
        const orderId = result.insertId;

        // 2. Guardar Detalles (Iteramos el carrito)
        const cartItems = req.session.cart.map(item => [orderId, item.id, item.quantity, item.price]);
        db.query('INSERT INTO order_details (order_id, product_id, quantity, price) VALUES ?', [cartItems], (err) => {
            if (err) throw err;
            
            // Vaciar carrito
            req.session.cart = [];
            
            // Redirigir a historial o ticket
            res.redirect('/history'); 
        });
    });
});

// HISTORIAL
app.get('/history', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    // Consulta JOIN compleja para traer todo
    const sql = 'SELECT * FROM orders WHERE user_id = ? ORDER BY date DESC';
    db.query(sql, [req.session.user.id], (err, orders) => {
        res.render('history', { orders });
    });
});

// GENERAR PDF (Ticket)
app.get('/invoice/:id', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const orderId = req.params.id;

    // Obtener datos de la orden y sus productos
    const sqlOrder = 'SELECT * FROM orders WHERE id = ? AND user_id = ?';
    const sqlDetails = `
        SELECT od.*, p.name 
        FROM order_details od 
        JOIN products p ON od.product_id = p.id 
        WHERE od.order_id = ?`;

    db.query(sqlOrder, [orderId, req.session.user.id], (err, orderResult) => {
        if (orderResult.length === 0) return res.send("Orden no encontrada");
        
        db.query(sqlDetails, [orderId], (err, detailsResult) => {
            
            // CREAR PDF
            const doc = new PDFDocument();
            const filename = `Ticket_Orden_${orderId}.pdf`;

            res.setHeader('Content-disposition', 'attachment; filename="' + filename + '"');
            res.setHeader('Content-type', 'application/pdf');

            doc.pipe(res);

            // Contenido PDF
            doc.fontSize(25).text('TechZone - Comprobante de Compra', { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Fecha: ${new Date(orderResult[0].date).toLocaleString()}`);
            doc.text(`Cliente: ${req.session.user.name}`);
            doc.text(`Orden ID: ${orderId}`);
            doc.moveDown();
            doc.text('-------------------------------------------------------');
            
            detailsResult.forEach(item => {
                doc.text(`${item.quantity} x ${item.name} - $${item.price}`);
            });
            
            doc.text('-------------------------------------------------------');
            doc.fontSize(16).text(`TOTAL PAGADO: $${orderResult[0].total}`, { align: 'right' });
            
            doc.end();
        });
    });
});


app.listen(3000, () => console.log('Servidor en http://localhost:3000'));

