const mongoose = require('mongoose');
const Account = require('../models/Account');
const Transaction = require('../models/Transaction');
const User = require('../models/User')

exports.transaction = async (req, res, next) => {
    let log = true
    const session = await mongoose.startSession();
    try {
        const { fromAcct, toAcct, amount : rawAmount } = req.body;
        const amount = Number(rawAmount)
        const id = req.userId
        const user = await User.findById(id).populate('accounts')
        if (!user) {
            const error = new Error('No User found');
            error.status = 404;
            return next(error);
        }
        const hisAccount = user.accounts.some(
            account => String(account.accountNumber) === fromAcct)
        if (!hisAccount) {
            const error = new Error(`Invalid transaction`);
            error.status = 401;
            return next(error);
        }

        await session.withTransaction(async () => {
            const sender = await Account.findOne({ accountNumber: fromAcct })
                .session(session);
            if (!sender || !sender.active) {
                const err = new Error('Invalid or inactive sender account');
                err.status = 404;
                throw err;
            }
            if (sender.balance < amount) {
                log = false
                const err = new Error('Insufficient funds');
                err.status = 400;
                throw err;
            }
            const recipient = await Account.findOne({ accountNumber: toAcct })
                .session(session);
            if (!recipient || !recipient.active) {
                const err = new Error('Invalid or inactive recipient account');
                err.status = 404;
                throw err;
            }
            const [txn] = await Transaction.create([{
                senderAccount: fromAcct,
                recipientAccount: toAcct,
                amount,
                success: true
            }], { session: session });

            const senderUpdate = await Account.updateOne(
                { _id: sender._id, balance: { $gte: amount }, active: true },
                { $inc: { balance: -amount }, $push: { transactions: txn._id } },
                { session: session })

            if (senderUpdate.modifiedCount === 0) {
                log = false;
                await Transaction.updateOne({ _id: txn._id }, { success: false }, { session });
                const err = new Error('Insufficient funds or invalid sender');
                err.status = 404;
                throw err;
            }

            await Account.updateOne(
                { _id: recipient._id, active: true },
                { $inc: { balance: amount }, $push: { transactions: txn._id } },
                { session: session }
            )
        });

        session.endSession();
        return res.status(200).json({ message: 'Transfer successful' });
    } catch (err) {
        session.endSession();
        return next(err);
    }
};

exports.updateBalance = async (req, res, next) => {
    try {
        const { accountNum, amount } = req.body
        const id = req.userId

        const user = await User.findById(id).populate('accounts')
        if (!user) {
            const error = new Error('No user found')
            error.status = 404
            throw error
        }
        const sameAccount = user.accounts.some(account =>
            String(account.accountNumber) === accountNum)
        if (!sameAccount) {
            const error = new Error("Can't update this account")
            error.status = 401
            throw error

        }
        const updatedAccount = await Account.findOne({ accountNumber: accountNum })
        if (!updatedAccount || !updatedAccount.active) {
            const error = new Error("Invalid or inactive account")
            error.status = 403
            throw error
        }
        if (amount < 0 && updatedAccount.balance < Math.abs(amount)) {
            const error = new Error('Insufficent balance')
            error.status = 400
            throw error
        }
        updatedAccount.balance += amount
        await updatedAccount.save()
        return res.status(200).json({ message: 'Balance is updated' });
    } catch (error) {

        return next(error)
    }
}
