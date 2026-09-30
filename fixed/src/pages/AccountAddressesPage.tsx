import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { AddressForm, EMPTY_ADDRESS } from "@/components/AddressForm"
import { useAuth } from "@/context/AuthContext"
import { countryName } from "@/lib/checkout"
import { deleteAddress, makeDefaultAddress, MAX_ADDRESSES, saveAddress, useAddresses, type SavedAddress } from "@/lib/account"
import { useTitle } from "@/hooks/use-title"

export function AccountAddressesPage() {
  useTitle("Your addresses")
  const { user, profile } = useAuth()
  const queryClient = useQueryClient()
  const { data: addresses = [], isLoading } = useAddresses(user?.id)
  const [editing, setEditing] = useState<string | "new" | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["addresses"] })

  const errorText = (code: string) =>
    code === "address_limit" ? `You can save up to ${MAX_ADDRESSES} addresses. Remove one to add another.` : "We couldn't save this address. Please try again."

  if (isLoading) return <p className="py-10 text-muted-foreground">Loading your addresses…</p>

  return (
    <div className="max-w-4xl">
      <p className="max-w-xl text-muted-foreground">
        Save up to {MAX_ADDRESSES} addresses and pick one at checkout. Your default address is filled in for you.
      </p>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2">
        {addresses.map((a) =>
          editing === a.id ? (
            <li key={a.id} className="border p-6 sm:col-span-2">
              <AddressForm
                initial={a}
                submitLabel="Save address"
                onCancel={() => setEditing(null)}
                onSubmit={async (input) => {
                  const r = await saveAddress(input, a.id)
                  if (!r.ok) return errorText(r.code)
                  await refresh()
                  setEditing(null)
                  toast.success("Address saved.")
                  return null
                }}
              />
            </li>
          ) : (
            <AddressCard
              key={a.id}
              address={a}
              onEdit={() => setEditing(a.id)}
              onDelete={async () => {
                if (!window.confirm("Remove this address?")) return
                if (await deleteAddress(a.id)) {
                  await refresh()
                  toast("Address removed.")
                } else toast.error("We couldn't remove it. Please try again.")
              }}
              onMakeDefault={async () => {
                if (await makeDefaultAddress(a.id)) await refresh()
                else toast.error("We couldn't change your default address.")
              }}
            />
          ),
        )}
      </ul>

      {editing === "new" ? (
        <div className="mt-6 border p-6">
          <h2 className="mb-6 text-xl">New address</h2>
          <AddressForm
            initial={{ ...EMPTY_ADDRESS, full_name: profile?.full_name ?? "" }}
            submitLabel="Save address"
            showDefault={addresses.length > 0}
            onCancel={() => setEditing(null)}
            onSubmit={async (input) => {
              const r = await saveAddress(input)
              if (!r.ok) return errorText(r.code)
              await refresh()
              setEditing(null)
              toast.success("Address saved.")
              return null
            }}
          />
        </div>
      ) : addresses.length < MAX_ADDRESSES ? (
        <Button variant="outline" onClick={() => setEditing("new")} className="mt-6 h-11 rounded-none border-dashed bg-transparent px-6">
          <Plus className="size-4" /> Add an address
        </Button>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">You've saved {MAX_ADDRESSES} addresses — remove one to add another.</p>
      )}
    </div>
  )
}

function AddressCard({
  address: a,
  onEdit,
  onDelete,
  onMakeDefault,
}: {
  address: SavedAddress
  onEdit: () => void
  onDelete: () => void
  onMakeDefault: () => void
}) {
  return (
    <li className="flex flex-col border p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{a.label || a.full_name}</p>
        {a.is_default && <span className="bg-foreground px-2 py-1 text-[0.7rem] font-semibold tracking-[0.12em] text-background uppercase">Default</span>}
      </div>
      <address className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground not-italic">
        {a.label && (
          <>
            {a.full_name}
            <br />
          </>
        )}
        {a.address_line1}
        {a.address_line2 && <>, {a.address_line2}</>}
        <br />
        {a.postal_code} {a.city}, {countryName(a.country)}
        <br />
        {a.phone}
      </address>
      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <button onClick={onEdit} className="underline underline-offset-4">
          Edit
        </button>
        {!a.is_default && (
          <button onClick={onMakeDefault} className="underline underline-offset-4">
            Make default
          </button>
        )}
        <button onClick={onDelete} className="text-muted-foreground underline underline-offset-4 hover:text-destructive">
          Remove
        </button>
      </div>
    </li>
  )
}
