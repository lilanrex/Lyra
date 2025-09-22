use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("DzSFtsfM8tdSEzxxV5mnJFiBVLNFZrirDGH2QR38SqRb");

#[program]
pub mod finai_budget {
    use super::*;

    pub fn initialize_user_budget(ctx: Context<InitializeUserBudget>, budget: u64) -> Result<()> {
        let user_budget = &mut ctx.accounts.user_budget;
        user_budget.owner = ctx.accounts.owner.key();
        user_budget.budget = budget;
        user_budget.spent = 0;
        user_budget.sol_savings = 0;
        
        msg!("User budget initialized for: {}, budget: {}", ctx.accounts.owner.key(), budget);
        Ok(())
    }

    pub fn set_budget(ctx: Context<SetBudget>, new_budget: u64) -> Result<()> {
        let user_budget = &mut ctx.accounts.user_budget;
        require!(ctx.accounts.owner.key() == user_budget.owner, BudgetError::Unauthorized);
        
        user_budget.budget = new_budget;
        user_budget.spent = 0;
        
        msg!("Budget updated to: {}", new_budget);
        Ok(())
    }

    pub fn record_expense(ctx: Context<RecordExpense>, amount: u64) -> Result<()> {
        let user_budget = &mut ctx.accounts.user_budget;
        require!(ctx.accounts.owner.key() == user_budget.owner, BudgetError::Unauthorized);

        user_budget.spent = user_budget.spent
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // Calculate savings: budget - spent (with saturation to avoid underflow)
        let savings = user_budget.budget.saturating_sub(user_budget.spent);

        emit!(ExpenseRecorded {
            owner: ctx.accounts.owner.key(),
            amount,
            new_total: user_budget.spent,
            savings,
        });

        Ok(())
    }

    // ---------------- SOL Savings ----------------
    pub fn deposit_sol(ctx: Context<DepositSol>, amount: u64) -> Result<()> {
        let user_budget = &mut ctx.accounts.user_budget;
        require!(ctx.accounts.owner.key() == user_budget.owner, BudgetError::Unauthorized);

        // Transfer lamports from user to vault
        let ix = anchor_lang::system_program::Transfer {
            from: ctx.accounts.owner.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), ix);
        anchor_lang::system_program::transfer(cpi_ctx, amount)?;

        user_budget.sol_savings = user_budget.sol_savings
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        emit!(SolSavingsDeposited {
            owner: ctx.accounts.owner.key(),
            amount,
            total_savings: user_budget.sol_savings,
        });

        Ok(())
    }

    pub fn withdraw_sol(ctx: Context<WithdrawSol>, amount: u64) -> Result<()> {
        let user_budget = &mut ctx.accounts.user_budget;
        require!(ctx.accounts.owner.key() == user_budget.owner, BudgetError::Unauthorized);
        require!(amount <= user_budget.sol_savings, BudgetError::InsufficientSavings);

        // Use vault PDA seeds for signing
        let seeds = &[
            b"vault",
            user_budget.owner.as_ref(),
            &[ctx.bumps.vault],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer SOL from vault PDA to user using invoke_signed
        let ix = anchor_lang::system_program::Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.owner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(), 
            ix,
            signer_seeds
        );
        anchor_lang::system_program::transfer(cpi_ctx, amount)?;

        user_budget.sol_savings = user_budget.sol_savings
            .checked_sub(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        emit!(SolSavingsWithdrawn {
            owner: ctx.accounts.owner.key(),
            amount,
            remaining_savings: user_budget.sol_savings,
        });

        Ok(())
    }

    // ---------------- USDC Savings ----------------
    pub fn deposit_usdc(ctx: Context<DepositUsdc>, amount: u64) -> Result<()> {
        let user_budget = &ctx.accounts.user_budget;
        require!(ctx.accounts.owner.key() == user_budget.owner, BudgetError::Unauthorized);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.owner_ata.to_account_info(),
                to: ctx.accounts.vault_ata.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        emit!(UsdcSavingsDeposited {
            owner: ctx.accounts.owner.key(),
            amount,
        });

        Ok(())
    }

    pub fn withdraw_usdc(ctx: Context<WithdrawUsdc>, amount: u64) -> Result<()> {
        let user_budget = &ctx.accounts.user_budget;
        require!(ctx.accounts.owner.key() == user_budget.owner, BudgetError::Unauthorized);

        // Use vault PDA seeds for signing
        let seeds = &[
            b"vault",
            user_budget.owner.as_ref(),
            &[ctx.bumps.vault],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_ata.to_account_info(),
                to: ctx.accounts.owner_ata.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(), // vault PDA is the authority
            },
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        emit!(UsdcSavingsWithdrawn {
            owner: ctx.accounts.owner.key(),
            amount,
        });

        Ok(())
    }
}

// ---------------- Contexts ----------------

#[derive(Accounts)]
pub struct InitializeUserBudget<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 8 + 8 + 8, // discriminator + owner + budget + spent + sol_savings
        seeds = [b"user_budget", owner.key().as_ref()],
        bump
    )]
    pub user_budget: Account<'info, UserBudget>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetBudget<'info> {
    #[account(
        mut, 
        seeds = [b"user_budget", owner.key().as_ref()], 
        bump
    )]
    pub user_budget: Account<'info, UserBudget>,
    
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecordExpense<'info> {
    #[account(
        mut, 
        seeds = [b"user_budget", owner.key().as_ref()], 
        bump
    )]
    pub user_budget: Account<'info, UserBudget>,
    
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(
        mut, 
        seeds = [b"user_budget", owner.key().as_ref()], 
        bump
    )]
    pub user_budget: Account<'info, UserBudget>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    /// CHECK: This is the vault PDA that will receive SOL
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(
        mut, 
        seeds = [b"user_budget", owner.key().as_ref()], 
        bump
    )]
    pub user_budget: Account<'info, UserBudget>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    /// CHECK: This is the vault PDA that will send SOL
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositUsdc<'info> {
    #[account(
        mut, 
        seeds = [b"user_budget", owner.key().as_ref()], 
        bump
    )]
    pub user_budget: Account<'info, UserBudget>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(mut)]
    pub owner_ata: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_ata: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawUsdc<'info> {
    #[account(
        seeds = [b"user_budget", owner.key().as_ref()], 
        bump
    )]
    pub user_budget: Account<'info, UserBudget>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    #[account(mut)]
    pub owner_ata: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_ata: Account<'info, TokenAccount>,
    
    /// CHECK: This is the vault PDA that owns the vault_ata
    #[account(
        seeds = [b"vault", owner.key().as_ref()],
        bump
    )]
    pub vault: AccountInfo<'info>,
    
    pub token_program: Program<'info, Token>,
}

// ---------------- State ----------------

#[account]
pub struct UserBudget {
    pub owner: Pubkey,      // 32 bytes
    pub budget: u64,        // 8 bytes
    pub spent: u64,         // 8 bytes
    pub sol_savings: u64,   // 8 bytes
}

#[error_code]
pub enum BudgetError {
    #[msg("You are not authorized to modify this budget")]
    Unauthorized,
    #[msg("Insufficient savings to withdraw")]
    InsufficientSavings,
}

// ---------------- Events ----------------

#[event]
pub struct ExpenseRecorded {
    pub owner: Pubkey,
    pub amount: u64,
    pub new_total: u64,
    pub savings: u64,
}

#[event]
pub struct SolSavingsDeposited {
    pub owner: Pubkey,
    pub amount: u64,
    pub total_savings: u64,
}

#[event]
pub struct SolSavingsWithdrawn {
    pub owner: Pubkey,
    pub amount: u64,
    pub remaining_savings: u64,
}

#[event]
pub struct UsdcSavingsDeposited {
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct UsdcSavingsWithdrawn {
    pub owner: Pubkey,
    pub amount: u64,
}