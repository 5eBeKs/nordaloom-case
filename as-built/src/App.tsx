import { BrowserRouter, Route, Routes } from "react-router-dom"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { persistOptions, queryClient, useLiveCatalogue } from "@/lib/offline"
import { OfflineNotice } from "@/components/layout/OfflineNotice"
import { Toaster } from "@/components/ui/sonner"
import { AuthProvider } from "@/context/AuthContext"
import { CartProvider } from "@/context/CartContext"
import { WishlistProvider } from "@/context/WishlistContext"
import { Layout } from "@/components/layout/Layout"
import { HomePage } from "@/pages/HomePage"
import { ShopPage } from "@/pages/ShopPage"
import { ProductPage } from "@/pages/ProductPage"
import { CartPage } from "@/pages/CartPage"
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "@/pages/AuthPages"
import { AccountDetailsPage, AccountLayout } from "@/pages/AccountPage"
import { AccountOrdersPage } from "@/pages/AccountOrdersPage"
import { AccountAddressesPage } from "@/pages/AccountAddressesPage"
import { AccountReviewsPage } from "@/pages/AccountReviewsPage"
import { WishlistPage } from "@/pages/WishlistPage"
import { ReturnRequestPage } from "@/pages/ReturnRequestPage"
import { CheckoutPage } from "@/pages/CheckoutPage"
import { OrderConfirmationPage } from "@/pages/OrderConfirmationPage"
import { AdminLayout } from "@/admin/AdminLayout"
import { DashboardPage } from "@/admin/DashboardPage"
import { OrdersPage } from "@/admin/OrdersPage"
import { OrderDetailPage } from "@/admin/OrderDetailPage"
import { ReturnsPage } from "@/admin/ReturnsPage"
import { ProductsPage } from "@/admin/ProductsPage"
import { ProductEditorPage } from "@/admin/ProductEditorPage"
import { StockPage } from "@/admin/StockPage"
import { DiscountsPage } from "@/admin/DiscountsPage"
import { EmailsPage } from "@/admin/EmailsPage"
import { ReviewsPage } from "@/admin/ReviewsPage"
import { CustomerDetailPage, CustomersPage } from "@/admin/CustomersPage"
import { AboutPage, CarePage, NotFoundPage } from "@/pages/ContentPages"
import { ReturnsPage as ReturnsPolicyPage, ShippingPage } from "@/pages/help/ShippingReturnsPages"
import { FaqPage, SizeGuidePage } from "@/pages/help/SizeGuideFaqPages"
import { ContactPage } from "@/pages/help/ContactPage"
import { PrivacyPage, TermsPage } from "@/pages/help/LegalPages"
import { MessagesPage } from "@/admin/MessagesPage"
import { ReportsPage } from "@/admin/ReportsPage"

export default function App() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <LiveCatalogue />
      <AuthProvider>
        <CartProvider>
          <WishlistProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<Layout />}>
                <Route index element={<HomePage />} />
                <Route path="shop" element={<ShopPage />} />
                <Route path="shop/:category" element={<ShopPage />} />
                <Route path="search" element={<ShopPage mode="search" />} />
                <Route path="product/:slug" element={<ProductPage />} />
                <Route path="cart" element={<CartPage />} />
                <Route path="wishlist" element={<WishlistPage />} />
                <Route path="checkout" element={<CheckoutPage />} />
                <Route path="order/:orderNumber" element={<OrderConfirmationPage />} />
                <Route path="login" element={<LoginPage />} />
                <Route path="register" element={<RegisterPage />} />
                <Route path="forgot-password" element={<ForgotPasswordPage />} />
                <Route path="reset-password" element={<ResetPasswordPage />} />
                <Route path="account" element={<AccountLayout />}>
                  <Route index element={<AccountOrdersPage />} />
                  <Route path="reviews" element={<AccountReviewsPage />} />
                  <Route path="addresses" element={<AccountAddressesPage />} />
                  <Route path="details" element={<AccountDetailsPage />} />
                  <Route path="orders/:orderNumber/return" element={<ReturnRequestPage />} />
                </Route>
                <Route path="about" element={<AboutPage />} />
                <Route path="care" element={<CarePage />} />
                <Route path="shipping" element={<ShippingPage />} />
                <Route path="returns" element={<ReturnsPolicyPage />} />
                <Route path="size-guide" element={<SizeGuidePage />} />
                <Route path="faq" element={<FaqPage />} />
                <Route path="contact" element={<ContactPage />} />
                <Route path="terms" element={<TermsPage />} />
                <Route path="privacy" element={<PrivacyPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
              <Route path="admin" element={<AdminLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="orders" element={<OrdersPage />} />
                <Route path="orders/:orderNumber" element={<OrderDetailPage />} />
                <Route path="returns" element={<ReturnsPage />} />
                <Route path="reviews" element={<ReviewsPage />} />
                <Route path="products" element={<ProductsPage />} />
                <Route path="products/new" element={<ProductEditorPage />} />
                <Route path="products/:id" element={<ProductEditorPage />} />
                <Route path="stock" element={<StockPage />} />
                <Route path="discounts" element={<DiscountsPage />} />
                <Route path="emails" element={<EmailsPage />} />
                <Route path="messages" element={<MessagesPage />} />
                <Route path="customers" element={<CustomersPage />} />
                <Route path="customers/:email" element={<CustomerDetailPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
          </WishlistProvider>
          <OfflineNotice />
          <Toaster position="bottom-center" />
        </CartProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  )
}

function LiveCatalogue() {
  useLiveCatalogue()
  return null
}
